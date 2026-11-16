'use strict';
const { randomBytes } = require('node:crypto');

const rooms = new Map();
const id = (bytes = 16) => randomBytes(bytes).toString('base64url');
const MINUTE = 60000;
function send(res,status,body) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
}
async function body(req) {
  if (req.headers['content-type'] !== 'application/json') throw new Error('Requête invalide.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 48000) throw new Error('Message trop long.');
    chunks.push(chunk);
  }
  const result = JSON.parse(Buffer.concat(chunks).toString());
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Message invalide.');
  return result;
}
function prune() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    for (const [key, peer] of room.peers) if (now-peer.seen > 3*MINUTE) room.peers.delete(key);
    if (!room.peers.has(room.host) || now-room.created > 8*60*MINUTE) rooms.delete(code);
  }
}
function participant(room,name) {
  const peer = {id:id(8),secret:id(24),name:String(name || 'Participant').trim().slice(0,32) || 'Participant',seen:Date.now(),messages:[]};
  room.peers.set(peer.id,peer);
  return peer;
}
function joinResponse(room,peer) {
  const iceServers = [{urls:'stun:stun.l.google.com:19302'}];
  const {REUNIONS_TURN_URL,REUNIONS_TURN_USER,REUNIONS_TURN_PASSWORD} = process.env;
  if (/^turns?:/.test(REUNIONS_TURN_URL || '') && REUNIONS_TURN_USER && REUNIONS_TURN_PASSWORD) {
    iceServers.push({urls:REUNIONS_TURN_URL,username:REUNIONS_TURN_USER,credential:REUNIONS_TURN_PASSWORD});
  }
  return {id:peer.id,token:peer.secret,code:room.code,iceServers};
}
function externalOrigin() {
  const value = process.env.REUNIONS_PUBLIC_URL;
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.origin : null; }
  catch { return null; }
}

async function handle(req,res,path,local,origin) {
  if (!path.startsWith('/api/rooms')) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site' || (req.method === 'POST' && req.headers.origin !== origin)) {
    send(res,403,{error:'Requête réservée à cette salle.'}); return true;
  }
  try {
    prune();
    if (path === '/api/rooms' && req.method === 'POST' && local) {
      if (rooms.size >= 30) { send(res,503,{error:'Trop de salles ouvertes.'}); return true; }
      const input = await body(req);
      const room = {code:id(),peers:new Map(),created:Date.now(),recording:false};
      const host = participant(room,input.name || 'Hôte');
      room.host = host.id;
      rooms.set(room.code,room);
      const publicUrl = externalOrigin();
      send(res,201,{...joinResponse(room,host),invite:`${publicUrl || origin}/room?code=${room.code}`,online:!!publicUrl});
      return true;
    }
    const match = /^\/api\/rooms\/([a-zA-Z0-9_-]{22})\/(join|poll|signal|record|leave)$/.exec(path);
    const room = match && rooms.get(match[1]);
    if (!room) { send(res,404,{error:'Salle introuvable ou fermée.'}); return true; }
    const op = match[2];
    if (op === 'join' && req.method === 'POST') {
      const input = await body(req);
      if (input.consent !== true) { send(res,400,{error:'L’accord d’enregistrement est requis pour entrer.'}); return true; }
      if (room.peers.size >= 6) { send(res,409,{error:'La salle est complète.'}); return true; }
      send(res,201,joinResponse(room,participant(room,input.name))); return true;
    }
    const peer = room.peers.get(req.headers['x-room-peer']);
    if (!peer || peer.secret !== req.headers['x-room-token']) { send(res,403,{error:'Session expirée.'}); return true; }
    peer.seen = Date.now();
    if (op === 'poll' && req.method === 'GET') {
      send(res,200,{peers:Array.from(room.peers.values(),p=>({id:p.id,name:p.name,host:p.id === room.host})),
        messages:peer.messages.splice(0),recording:room.recording}); return true;
    }
    if (req.method !== 'POST') { send(res,405,{error:'Action indisponible.'}); return true; }
    const input = await body(req);
    if (op === 'signal') {
      const target = room.peers.get(input.to);
      if (!target || target === peer || !['offer','answer','candidate'].includes(input.kind) || !input.data || typeof input.data !== 'object') {
        send(res,400,{error:'Signal audio invalide.'}); return true;
      }
      if (target.messages.length >= 160) { send(res,429,{error:'Le correspondant ne répond pas.'}); return true; }
      target.messages.push({from:peer.id,kind:input.kind,data:input.data});
    } else if (op === 'record' && peer.id === room.host) {
      room.recording = input.active === true;
    } else if (op === 'leave') {
      room.peers.delete(peer.id);
      if (peer.id === room.host) rooms.delete(room.code);
    } else { send(res,403,{error:'Action réservée à l’hôte.'}); return true; }
    send(res,200,{ok:true});
  } catch (error) {
    if (!res.destroyed) send(res,400,{error:error.message});
  }
  return true;
}

module.exports = {handle,externalOrigin};
