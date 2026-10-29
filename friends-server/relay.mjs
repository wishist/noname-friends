// Protocol adapted from libnoname/noname packages/server/src/server/createServer.ts.
// Upstream: https://github.com/libnoname/noname — see ../LICENSE (GPL-3.0).
import { randomBytes } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';

export function createRelay(server, { path = '/relay', publicOrigin, maxClients = 256 } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });
  const clients = new Map();
  const rooms = new Map();
  const events = [];
  const send = (client, ...values) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(values));
  };
  const label = value => typeof value === 'string' ? value.slice(0, 24) : '无名玩家';
  const avatar = value => typeof value === 'string' ? value.slice(0, 100) : 'caocao';
  const roomList = () => [...rooms.values()].filter(room => room.owner && room.config).map(room => [
    room.owner.nickname, room.owner.avatar, room.config,
    [...clients.values()].filter(client => client.room === room).length, room.key,
  ]);
  const clientList = () => [...clients.values()].map(client => [client.nickname, client.avatar, !client.room, client.status, client.wsid, client.onlineKey]);
  const update = () => {
    const roomData = roomList(), clientData = clientList();
    for (const client of clients.values()) if (!client.room) send(client, 'updaterooms', roomData, clientData);
  };
  const cleanEvents = () => {
    for (let i = events.length - 1; i >= 0; i--) if (events[i].utc <= Date.now()) events.splice(i, 1);
    return events;
  };
  const handlers = {
    key(client, id) {
      if (!Array.isArray(id) || typeof id[0] !== 'string' || id[0].length < 1 || id[0].length > 128) {
        send(client, 'denied', 'key'); client.close(); return;
      }
      if (client.onlineKey && client.onlineKey !== id[0]) return;
      client.onlineKey = id[0]; clearTimeout(client.keyTimer);
    },
    create(client, key, nickname, portrait) {
      if (!client.onlineKey || client.onlineKey !== key || client.room) return;
      if (rooms.has(key)) { send(client, 'enterroomfailed'); return; }
      client.nickname = label(nickname); client.avatar = avatar(portrait);
      const room = { key, owner: client };
      rooms.set(key, room); client.room = room; delete client.status;
      send(client, 'createroom', key); update();
    },
    enter(client, key, nickname, portrait) {
      if (!client.onlineKey || client.room) { send(client, 'enterroomfailed'); return; }
      const room = rooms.get(key);
      // Validate before assigning room/owner, so failed joins stay in the lobby.
      if (!room?.owner || !room.config || room.owner.readyState !== WebSocket.OPEN ||
          (room.config.gameStarted && (!room.config.observe || !room.config.observeReady))) {
        send(client, 'enterroomfailed'); return;
      }
      client.nickname = label(nickname); client.avatar = avatar(portrait);
      client.room = room; client.owner = room.owner; delete client.status;
      send(room.owner, 'onconnection', client.wsid); update();
    },
    config(client, config) {
      if (!client.room || client.room.owner !== client || !config || typeof config !== 'object' || Array.isArray(config)) return;
      client.room.config = config; update();
    },
    send(client, id, message) {
      const target = clients.get(id);
      if (target?.owner === client && typeof message === 'string' && target.readyState === WebSocket.OPEN) target.send(message);
    },
    close(client, id) {
      const target = clients.get(id);
      if (target?.owner === client) target.close();
    },
    changeAvatar(client, nickname, portrait) {
      client.nickname = label(nickname); client.avatar = avatar(portrait); update();
    },
    status(client, status) {
      client.status = typeof status === 'string' ? status.slice(0, 200) : undefined; update();
    },
    events(client, config, id, type) {
      if (id !== client.onlineKey) return;
      cleanEvents();
      if (typeof config === 'string') {
        const event = events.find(item => item.id === config);
        if (!event) return;
        if (type === 'join' && !event.members.includes(id)) event.members.push(id);
        if (type === 'leave') event.members = event.members.filter(member => member !== id);
      } else if (config && Number.isFinite(config.utc) && config.utc > Date.now() && typeof config.content === 'string' && config.content.length <= 500 && events.length < 20) {
        events.push({ id: randomBytes(12).toString('hex'), creator: id, nickname: label(config.nickname), avatar: avatar(config.avatar), utc: config.utc, day: config.day, hour: config.hour, content: config.content, members: [id] });
      }
      for (const target of clients.values()) if (!target.room) send(target, 'updateevents', events);
    },
  };
  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { socket.destroy(); return; }
    if (url.pathname !== path || clients.size >= maxClients) { socket.destroy(); return; }
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        const allowed = publicOrigin ? origin.origin === new URL(publicOrigin).origin : origin.host === req.headers.host;
        if (!allowed) { socket.destroy(); return; }
      } catch { socket.destroy(); return; }
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', client => {
    client.wsid = randomBytes(12).toString('hex'); client.nickname = '无名玩家'; client.avatar = 'caocao';
    clients.set(client.wsid, client);
    client.keyTimer = setTimeout(() => { send(client, 'denied', 'key'); client.close(); }, 10000);
    client.keyTimer.unref();
    client.alive = true;
    client.on('pong', () => { client.alive = true; });
    send(client, 'roomlist', roomList(), cleanEvents(), clientList(), client.wsid);
    client.on('error', () => {});
    client.on('message', (buffer, binary) => {
      if (binary) return client.close(1003, 'Text messages only');
      const raw = buffer.toString();
      if (raw === 'heartbeat') { client.alive = true; return; }
      if (client.owner) { send(client.owner, 'onmessage', client.wsid, raw); return; }
      let data;
      try { data = JSON.parse(raw); } catch { send(client, 'denied', 'key'); return; }
      if (!Array.isArray(data) || data[0] !== 'server' || typeof data[1] !== 'string') return;
      const handler = Object.hasOwn(handlers, data[1]) ? handlers[data[1]] : null;
      if (!handler || (!client.onlineKey && data[1] !== 'key')) return;
      handler(client, ...data.slice(2));
    });
    client.on('close', () => {
      clearTimeout(client.keyTimer);
      if (client.room?.owner === client) {
        rooms.delete(client.room.key);
        for (const other of clients.values()) {
          if (other.owner === client) { send(other, 'selfclose'); other.close(); }
        }
      } else if (client.owner) send(client.owner, 'onclose', client.wsid);
      clients.delete(client.wsid); update();
    });
  });
  const heartbeat = setInterval(() => {
    for (const client of clients.values()) {
      if (!client.alive) client.terminate();
      else { client.alive = false; client.ping(); }
    }
  }, 30000);
  heartbeat.unref();
  return {
    getStats: () => ({ clients: clients.size, rooms: rooms.size }),
    async close() {
      clearInterval(heartbeat);
      for (const client of clients.values()) { clearTimeout(client.keyTimer); client.terminate(); }
      await new Promise(resolve => wss.close(resolve));
    },
  };
}
