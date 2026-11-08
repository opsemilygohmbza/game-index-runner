export function cooldownUntil(state,attempt,now=Date.now()) {
  const seconds=Number(state.pauseRetryAfter);
  const date=Date.parse(state.pauseRetryAfter||'');
  let until=Number.isFinite(seconds)&&seconds>0?now+seconds*1000:
    Number.isFinite(date)&&date>now?date:now+Math.min(120*2**attempt,1800)*1000;
  if(state.pauseRemaining==='0')until=Math.max(until,Number(state.pauseResetAt)*1000+1000);
  return Number.isFinite(until)?until:now+120000;
}
