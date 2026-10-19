"""WSL-only QEMU lab. Uses no host block devices, networking or shared writable folders."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

p = argparse.ArgumentParser()
p.add_argument("--lab", required=True)
p.add_argument("--iso", required=True)
p.add_argument("--resume-preparation", action="store_true")
args = p.parse_args()
lab = Path(args.lab).resolve()
iso = Path(args.iso).resolve()
metadata = json.loads((lab / "lab.json").read_text())
previous = json.loads((lab / "run.json").read_text()) if (lab / "run.json").exists() else None
if previous and (not args.resume_preparation or previous["phase"] != "preparing"):
    raise SystemExit("This lab already has a VM; inspect it or prepare a new lab directory.")
work = Path(previous["work"]) if previous and Path(previous["work"]).is_dir() else Path.home() / ".cache/cadbridge-windows-labs" / metadata["nonce"]
work.mkdir(parents=True, exist_ok=True)
state = {"work": str(work), "lab": str(lab), "iso": str(iso), "nonce": metadata["nonce"], "phase": "preparing", "network": "none", "memoryMiB": 4096, "vcpus": 2, "hostBlockDevices": []}
def save():
    (lab / "run.json").write_text(json.dumps(state, indent=2))
def command(values, log):
    with (lab / log).open("w") as output:
        subprocess.run(values, check=True, stdout=output, stderr=subprocess.STDOUT)
save()
state["isoSHA256"] = previous.get("isoSHA256") if previous else None
if not state["isoSHA256"]:
    state["isoSHA256"] = hashlib.file_digest(iso.open("rb"), "sha256").hexdigest()
save()
# Microsoft's ISO has a UDF filesystem; its ISO9660 fallback is only a README.
# Extract the UDF with 7-Zip rather than remastering that incomplete fallback.
media = work / "media"
if not media.exists():
    extractor = shutil.which("7zz") or shutil.which("7z")
    if not extractor:
        raise SystemExit("Install Ubuntu's 7zip package before preparing this lab")
    command([extractor, "x", "-y", "-o" + str(media), str(iso)], "media-extract.txt")
shutil.copyfile(lab / "seed/autounattend.xml", media / "autounattend.xml")
shutil.copytree(lab / "seed/BridgeLab", media / "BridgeLab", dirs_exist_ok=True)
efi = next((f for f in media.rglob("*") if f.name.lower() == "efisys_noprompt.bin"), None)
if efi is None:
    raise SystemExit("No official EFI no-prompt boot image found; original install media preserved")
command(["xorriso", "-as", "mkisofs", "-iso-level", "3", "-J", "-joliet-long", "-V", "BRIDGE_WIN", "-e", str(efi.relative_to(media)), "-no-emul-boot", "-o", str(work / "install.iso"), str(media)], "media-build.txt")
command(["qemu-img", "create", "-f", "qcow2", str(work / "windows.qcow2"), "64G"], "disk-create.txt")
shutil.copyfile("/usr/share/OVMF/OVMF_VARS_4M.ms.fd", work / "vars.fd")
(work / "tpm").mkdir()
tpm_log = (lab / "tpm.txt").open("w")
tpm = subprocess.Popen(["swtpm", "socket", "--tpm2", "--tpmstate", "dir=" + str(work / "tpm"), "--ctrl", "type=unixio,path=" + str(work / "tpm.sock"), "--log", "level=1"], stdout=tpm_log, stderr=subprocess.STDOUT, start_new_session=True)
state["tpmPid"] = tpm.pid
for _ in range(100):
    if (work / "tpm.sock").exists():
        break
    time.sleep(.1)
else:
    raise SystemExit("TPM socket did not start")
qemu_command = ["qemu-system-x86_64", "-name", "CADBridgeCleanWindows", "-machine", "q35,smm=on", "-accel", "tcg,thread=multi,tb-size=256", "-cpu", "max", "-smp", "2", "-m", "4096", "-drive", "if=pflash,format=raw,unit=0,readonly=on,file=/usr/share/OVMF/OVMF_CODE_4M.ms.fd", "-drive", "if=pflash,format=raw,unit=1,file=" + str(work / "vars.fd"), "-drive", "file=" + str(work / "windows.qcow2") + ",format=qcow2,if=ide,index=0", "-drive", "file=" + str(work / "install.iso") + ",media=cdrom,if=ide,index=2,readonly=on", "-chardev", "socket,id=chrtpm,path=" + str(work / "tpm.sock"), "-tpmdev", "emulator,id=tpm0,chardev=chrtpm", "-device", "tpm-tis,tpmdev=tpm0", "-nic", "none", "-display", "none", "-vga", "std", "-serial", "file:" + str(lab / "serial.log"), "-qmp", "unix:" + str(work / "qmp.sock") + ",server=on,wait=off", "-boot", "order=dc", "-pidfile", str(work / "qemu.pid")]
state["command"] = qemu_command
qemu_log = (lab / "qemu.txt").open("w")
vm = subprocess.Popen(qemu_command, stdout=qemu_log, stderr=subprocess.STDOUT, start_new_session=True)
time.sleep(2)
if vm.poll() is not None:
    state["phase"] = "failed-to-start"
    save()
    tpm.terminate()
    raise SystemExit((lab / "qemu.txt").read_text())
state.update({"phase": "running", "qemuPid": vm.pid, "startedAt": time.time()})
save()
print(json.dumps({"ok": True, **state}), flush=True)
# Keep the WSL client alive for the duration of this test VM.
state["exitCode"] = vm.wait()
state["phase"] = "stopped"
save()
tpm.terminate()
print(json.dumps({"stopped": True, "exitCode": state["exitCode"]}), flush=True)
