const axios=require('axios');

function parseDelay(d,next){
  const raw=next?.next_stoppage_delay ?? d?.current_delay ?? 0;
  const n=Number(raw);
  return Number.isFinite(n)?n:0;
}

function normalize(trainNo,payload){
  const d=payload?.data||{};
  const next=d.next_stoppage_info||{};
  const location=Array.isArray(d.current_location_info)?d.current_location_info:[];
  const currentHint=location.find(x=>/travelling|current/i.test(String(x?.hint||"")))?.hint||null;
  return {
    id:String(d.train_number||d.train_no||trainNo),
    trainNumber:String(d.train_number||d.train_no||trainNo),
    name:d.train_name||`Train ${trainNo}`,
    status:d.train_status||d.current_status||'RUNNING',
    trainType:'PASSENGER',
    currentStation:d.current_station_name||d.current_station||d.current_location||null,
    currentStationCode:d.current_station_code||null,
    nextStation:next.next_stoppage||null,
    nextStationInfo:{
      title:next.next_stoppage_title||'Next stoppage',
      station:next.next_stoppage||null,
      timeDifference:next.next_stoppage_time_diff||null
    },
    delay:parseDelay(d,next),
    source:d.train_src||d.source||null,
    destination:d.train_dst||d.destination||null,
    direction:currentHint,
    priority:'MEDIUM',
    apiSource:'IRCTC RapidAPI',
    lastApiUpdate:new Date().toISOString()
  };
}

async function fetchLive(trainNo){
  if(!process.env.RAPIDAPI_KEY) return null;
  try{
    const r=await axios.get('https://irctc1.p.rapidapi.com/api/v1/liveTrainStatus',{
      params:{trainNo,startDay:0},
      headers:{
        'x-rapidapi-key':process.env.RAPIDAPI_KEY,
        'x-rapidapi-host':process.env.RAPIDAPI_HOST||'irctc1.p.rapidapi.com'
      },
      timeout:12000
    });
    if(!r.data?.status) return null;
    return normalize(trainNo,r.data);
  }catch(e){
    console.error(`Live API failed for ${trainNo}:`,e.response?.data?.message||e.message);
    return null;
  }
}
module.exports={fetchLive};
