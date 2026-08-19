
const fs=require('fs'),path=require('path');const file=path.join(__dirname,'../data/trains.json');
const read=()=>JSON.parse(fs.readFileSync(file,'utf8'));const write=x=>fs.writeFileSync(file,JSON.stringify(x,null,2));
const list=()=>read();const writeAll=write;const upsert=t=>{let a=read(),i=a.findIndex(x=>x.id===t.id||x.trainNumber===t.trainNumber);if(i>=0)a[i]={...a[i],...t};else a.push(t);write(a);return a};
const step=()=>{let a=read().map((t,i)=>{if(t.status!=='RUNNING')return t;let dx=(t.direction||1)*(t.speed||1.2);let x=(t.mapX??30)+dx,y=(t.mapY??50)+Math.sin(Date.now()/3500+i)*0.7;if(x>88||x<10){t.direction=-(t.direction||1);x=Math.max(10,Math.min(88,x))}return {...t,mapX:+x.toFixed(2),mapY:+Math.max(8,Math.min(88,y)).toFixed(2),lastUpdated:new Date().toISOString()}});write(a);return a};module.exports={list,upsert,step,writeAll};
