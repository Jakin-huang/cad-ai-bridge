export async function dependency(name){
  return import(name);
}
