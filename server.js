const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const port = 3080;

// 提供静态文件服务
app.use(express.static(path.join(__dirname)));

// 创建HTTP服务器
const server = http.createServer(app);

// 创建WebSocket服务器
const wss = new WebSocket.Server({ server });

// 房间管理
const room = {
  created: false,
  mode: 'normal',
  totalPlayers: 7,
  joinedPlayers: 0,
  players: []
};

// WebSocket连接处理
wss.on('connection', (ws) => {
  console.log('新的WebSocket连接');
  
  // 发送当前房间状态
  ws.send(JSON.stringify({
    type: 'roomStatus',
    room: room
  }));
  
  // 接收消息处理
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'createRoom':
          // 上帝创建房间
          room.created = true;
          room.mode = data.mode;
          room.totalPlayers = data.totalPlayers;
          room.joinedPlayers = 0;
          room.players = [];
          
          // 广播房间创建消息
          broadcast({
            type: 'roomCreated',
            room: room
          });
          break;
          
        case 'joinRoom':
          // 玩家加入房间
          if (room.created && room.joinedPlayers < room.totalPlayers) {
            const playerId = room.players.length + 1;
            const player = {
              id: playerId,
              nickname: data.nickname
            };
            
            room.players.push(player);
            room.joinedPlayers++;
            
            // 发送玩家ID给当前玩家
            ws.send(JSON.stringify({
              type: 'playerJoined',
              playerId: playerId
            }));
            
            // 广播玩家加入消息
            broadcast({
              type: 'playerJoined',
              player: player,
              room: room
            });
          }
          break;
      }
    } catch (error) {
      console.error('WebSocket消息处理错误:', error);
    }
  });
  
  // 连接关闭处理
  ws.on('close', () => {
    console.log('WebSocket连接关闭');
  });
});

// 广播消息给所有连接的客户端
function broadcast(message) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// 启动服务器
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`WebSocket server is ready`);
});
