'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const readline = require('node:readline');

function manageTunnel(guestPort) {
  const local = path.join(__dirname,'.tools',process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  const executable = process.env.REUNIONS_CLOUDFLARED || (fs.existsSync(local) ? local : 'cloudflared');
  let child, interval, retry, stopping = false, pending, misses = 0, busy = false;
  const clearUrls = () => { delete process.env.REUNIONS_PENDING_PUBLIC_URL; delete process.env.REUNIONS_PUBLIC_URL; pending = null; };
  async function check() {
    if (busy || !pending || stopping) return;
    busy = true;
    const address = pending;
    try {
      const response = await fetch(`${address}/room`,{cache:'no-store',signal:AbortSignal.timeout(6500)});
      if (!response.ok || !(await response.text()).includes('Réunions Studio')) throw new Error('Passerelle inaccessible');
      if (address !== pending) return;
      misses = 0;
      if (process.env.REUNIONS_PUBLIC_URL !== address) {
        process.env.REUNIONS_PUBLIC_URL = address;
        console.log('Lien HTTPS de la salle prêt. Copiez l’invitation actuelle après avoir créé une salle.');
      }
    } catch {
      // New Quick Tunnel names can take several minutes to propagate through DNS.
      if (address === pending && ++misses >= (process.env.REUNIONS_PUBLIC_URL ? 4 : 30)) {
        clearUrls();
        child?.kill();
      }
    } finally { busy = false; }
  }
  function start() {
    if (stopping) return;
    clearUrls(); misses = 0;
    child = spawn(executable,['tunnel','--protocol','http2','--url',`http://127.0.0.1:${guestPort}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    const current = child;
    let missing = false;
    const startup = setTimeout(()=>{ if (!pending) current.kill(); },45000);
    const lines = readline.createInterface({input:current.stderr});
    lines.on('line',line => {
      const found = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0];
      if (!pending && found) {
        pending = process.env.REUNIONS_PENDING_PUBLIC_URL = found.toLowerCase();
        check();
      }
      if (process.env.REUNIONS_DEBUG) console.error(line);
    });
    current.on('error',error => {
      missing = error.code === 'ENOENT';
      console.error(missing ? 'Cloudflared absent. Installez-le ou placez-le dans .tools.' : `Passerelle : ${error.message}`);
    });
    current.on('close',() => {
      clearTimeout(startup);
      clearUrls();
      if (!stopping && !missing) retry = setTimeout(start,5000);
    });
  }
  interval = setInterval(check,6000);
  start();
  return () => { stopping = true; clearInterval(interval); clearTimeout(retry); child?.kill(); clearUrls(); };
}

module.exports = {manageTunnel};
