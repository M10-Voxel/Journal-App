/** Share a load only while at least one consumer uses it. No persistent cache:
 * closing the last view releases our reference, even if its request is in flight. */
export function createSharedLoads<T>(load:(key:string)=>Promise<T>){
  const entries=new Map<string,{promise:Promise<T>;users:number}>();
  return {
    acquire(key:string){
      let entry=entries.get(key);
      if(!entry){entry={promise:Promise.resolve().then(()=>load(key)),users:0};entries.set(key,entry);}
      entry.users++;
      let released=false;
      const current=entry;
      return {promise:entry.promise,release(){
        if(released)return;released=true;
        if(--current.users===0 && entries.get(key)===current)entries.delete(key);
      }};
    },
  };
}
