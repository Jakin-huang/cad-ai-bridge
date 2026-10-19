export function failure(error,{stage='input',jobRoot,hostStarted=false,mutationCommitted,drawingSaved}={}){
 const message=error.message||String(error),prefix=message.match(/^([A-Z][A-Z0-9_]+):/);
 const code=prefix?.[1]||(error.name==='ZodError'?'INVALID_ARGUMENT':stage==='configuration'?'CONFIGURATION_ERROR':stage==='snapshot'?'INPUT_FILE_ERROR':stage==='launch'?'HOST_FAILED':'HOST_OR_INPUT_ERROR');
 const uncertain=hostStarted&&mutationCommitted===undefined;
 return{ok:false,error:{code,message,stage,next:uncertain?'使用 cad_get_job 查询已有任务，核对输出；不要自动重复写入。':stage==='configuration'?'调用 cad_doctor 检查环境和配置。':'检查错误与任务证据后修正输入。'},...(jobRoot?{jobRoot}:{}),...(mutationCommitted!==undefined?{mutationCommitted}:{}),...(drawingSaved!==undefined?{drawingSaved}:{}),outcome:uncertain?'unconfirmed':drawingSaved?'saved':mutationCommitted?'modified_not_saved':'not_applied',safeToRetry:!hostStarted};
}
