const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

const app = express();
const port = 3080;

// 提供静态文件服务
app.use(express.static(path.join(__dirname)));

// 创建HTTP服务器
const server = http.createServer(app);

// 创建WebSocket服务器
const wss = new WebSocket.Server({ server });

// 读取角色数据
let allCharacters = [];
try {
  const charsContent = fs.readFileSync(path.join(__dirname, 'chars.txt'), 'utf8');
  const lines = charsContent.split('\n');
  lines.forEach(line => {
    if (line.trim()) {
      const match = line.match(/'([^']+)':\s*'([^']+)'/);
      if (match) {
        allCharacters.push({
          name: match[1],
          skill: match[2]
        });
      }
    }
  });
  console.log(`成功加载 ${allCharacters.length} 个角色`);
} catch (error) {
  console.error('读取角色文件错误:', error);
}

// 读取身份数据
let roleConfigs = {};
try {
  const rolesContent = fs.readFileSync(path.join(__dirname, 'roles.txt'), 'utf8');
  const lines = rolesContent.split('\n');
  let currentMode = '';
  
  // 模式映射
  const modeMap = {
    '普通模式': 'normal',
    '里世界模式': 'inner'
  };
  
  // 人数映射
  const countMap = {
    '五人局': 5,
    '六人局': 6,
    '七人局': 7,
    '八人局': 8,
    '九人局': 9,
    '十人局': 10
  };
  
  lines.forEach(line => {
    line = line.trim();
    if (line) {
      // 检查是否是模式行
      for (const [key, value] of Object.entries(modeMap)) {
        if (line.includes(key)) {
          currentMode = value;
          roleConfigs[currentMode] = {};
          break;
        }
      }
      
      // 检查是否是人数行
      for (const [key, value] of Object.entries(countMap)) {
        if (line.includes(key)) {
          const match = line.match(/\[(.*?)\]/);
          if (match && currentMode) {
            const roles = match[1].split(',').map(role => role.trim());
            roleConfigs[currentMode][value] = roles;
          }
          break;
        }
      }
    }
  });
  console.log('成功加载身份配置:', roleConfigs);
} catch (error) {
  console.error('读取身份文件错误:', error);
}

// 随机打乱数组
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// 房间管理
const room = {
  created: false,
  mode: 'normal',
  totalPlayers: 7,
  joinedPlayers: 0,
  confirmedPlayers: 0,
  players: [],
  availableCharacters: [...allCharacters],
  environmentCards: []
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
          room.confirmedPlayers = 0;
          room.players = [];
          room.availableCharacters = [...allCharacters];
          
          // 广播房间创建消息
          broadcast({
            type: 'roomCreated',
            room: room
          });
          break;
          
        case 'joinRoom':
          // 玩家加入房间
          if (room.created && room.joinedPlayers < room.totalPlayers) {
            // 检查昵称是否已存在
            const nicknameExists = room.players.some(player => player.nickname === data.nickname);
            
            if (nicknameExists) {
              // 昵称已存在，发送错误消息
              ws.send(JSON.stringify({
                type: 'error',
                message: '昵称已存在，请使用其他昵称'
              }));
            } else {
              // 昵称不存在，允许加入
              const playerId = room.players.length + 1;
              const player = {
                id: playerId,
                nickname: data.nickname,
                order: playerId,
                character: null,
                confirmed: false
              };
              
              room.players.push(player);
              room.joinedPlayers++;
              
              // 发送玩家ID给当前玩家
              ws.send(JSON.stringify({
                type: 'playerJoined',
                playerId: playerId
              }));
              
              // 广播玩家加入消息（不包含playerId，避免其他玩家更新自己的编号）
              broadcast({
                type: 'playerJoined',
                player: player,
                room: room
              });
            }
          }
          break;
          
        case 'startGame':
          // 开始游戏 - 跳转到角色选择页面
          broadcast({
            type: 'startGame'
          });
          break;
          
        case 'requestCharacters':
          // 玩家请求分配角色
          if (room.availableCharacters.length >= 2) {
            // 随机选择两个不同的角色
            const randomIndices = [];
            while (randomIndices.length < 2) {
              const index = Math.floor(Math.random() * room.availableCharacters.length);
              if (!randomIndices.includes(index)) {
                randomIndices.push(index);
              }
            }
            
            const assignedCharacters = randomIndices.map(index => room.availableCharacters[index]);
            
            // 从可用角色中移除这两个角色
            room.availableCharacters = room.availableCharacters.filter((_, index) => !randomIndices.includes(index));
            
            // 发送分配的角色给玩家
            ws.send(JSON.stringify({
              type: 'assignCharacters',
              characters: assignedCharacters
            }));
          } else {
            // 角色不足
            ws.send(JSON.stringify({
              type: 'error',
              message: '角色不足，请联系上帝'
            }));
          }
          break;
          
        case 'confirmCharacter':
          // 玩家确认角色选择
          const playerIndex = room.players.findIndex(p => p.order === data.order);
          if (playerIndex !== -1) {
            room.players[playerIndex].character = data.character;
            room.players[playerIndex].skill = data.skill;
            room.players[playerIndex].confirmed = true;
            room.confirmedPlayers++;
            
            // 广播玩家确认角色消息
            broadcast({
              type: 'playerConfirmed',
              players: room.players.filter(p => p.confirmed)
            });
          }
          break;
          
        case 'requestRoomStatus':
          // 上帝面板请求房间状态
          console.log('收到 requestRoomStatus 消息，返回房间状态和玩家信息');
          ws.send(JSON.stringify({
            type: 'roomStatus',
            room: room,
            players: room.players,
            environmentCards: room.environmentCards
          }));
          break;
          
        case 'startDealing':
          // 开始发牌
          console.log('收到 startDealing 消息，准备为每个玩家分配手牌和身份并广播消息');
          
          // 分配身份
          const totalPlayersStr = room.totalPlayers.toString();
          console.log('开始分配身份，模式:', room.mode, '人数:', room.totalPlayers, '人数字符串:', totalPlayersStr);
          console.log('角色配置是否存在:', !!roleConfigs[room.mode]);
          if (roleConfigs[room.mode]) {
            console.log('当前模式的身份配置:', roleConfigs[room.mode]);
            console.log('对应人数的身份数组是否存在:', !!roleConfigs[room.mode][totalPlayersStr]);
          }
          
          if (roleConfigs[room.mode] && roleConfigs[room.mode][totalPlayersStr]) {
            // 获取对应模式和人数的身份数组
            let rolesArray = roleConfigs[room.mode][totalPlayersStr];
            console.log('原始身份数组:', rolesArray);
            // 打乱身份数组
            rolesArray = shuffleArray(rolesArray);
            console.log('打乱后的身份数组:', rolesArray);
            
            // 为每个玩家分配身份
            console.log('分配身份前的玩家列表:', room.players);
            room.players.forEach((player, index) => {
              if (index < rolesArray.length) {
                player.role = rolesArray[index];
                console.log('为玩家', player.order, player.nickname, '分配身份:', rolesArray[index]);
              } else {
                player.role = '未知身份';
                console.log('为玩家', player.order, player.nickname, '分配默认身份: 未知身份');
              }
              player.handCards = 5; // 假设每个玩家初始有5张手牌
            });
            console.log('分配身份后的玩家列表:', room.players);
          } else {
            console.error('未找到对应模式和人数的身份配置:', room.mode, totalPlayersStr);
            console.log('当前可用的身份配置:', roleConfigs);
            // 为每个玩家分配默认身份
            console.log('分配默认身份前的玩家列表:', room.players);
            room.players.forEach(player => {
              player.role = '乘客';
              console.log('为玩家', player.order, player.nickname, '分配默认身份: 乘客');
              player.handCards = 5; // 假设每个玩家初始有5张手牌
            });
            console.log('分配默认身份后的玩家列表:', room.players);
          }
          
          // 生成环境牌
          console.log('开始生成环境牌');
          
          // 定义环境牌数组
          const bigFartCards = ['臭屁', '闷屁', '蔫儿屁', '彩虹屁', '连环屁'];
          const smallFartCards = ['有屁', '有屁', '有屁'];
          const noFartCards = ['无屁', '无屁', '无屁', '无屁'];
          
          let environmentCards = [];
          
          // 根据模式和人数确定环境牌组合
          if (room.mode === 'normal' && room.totalPlayers === 5) {
            console.log('普通模式五人局：1张大屁 + 3张小屁 + 4张无屁');
            // 随机抽取1张不重复的大屁牌
            const selectedBigFartCards = [];
            while (selectedBigFartCards.length < 1) {
              const randomIndex = Math.floor(Math.random() * bigFartCards.length);
              const card = bigFartCards[randomIndex];
              if (!selectedBigFartCards.includes(card)) {
                selectedBigFartCards.push(card);
              }
            }
            // 组合环境牌
            environmentCards = [...selectedBigFartCards, ...smallFartCards, ...noFartCards];
          } else {
            console.log('其他情况：2张大屁 + 2张小屁 + 4张无屁');
            // 随机抽取2张不重复的大屁牌
            const selectedBigFartCards = [];
            while (selectedBigFartCards.length < 2) {
              const randomIndex = Math.floor(Math.random() * bigFartCards.length);
              const card = bigFartCards[randomIndex];
              if (!selectedBigFartCards.includes(card)) {
                selectedBigFartCards.push(card);
              }
            }
            // 组合环境牌（小屁牌只取前2张）
            environmentCards = [...selectedBigFartCards, ...smallFartCards.slice(0, 2), ...noFartCards];
          }
          
          // 打乱环境牌
          environmentCards = shuffleArray(environmentCards);
          console.log('打乱后的环境牌:', environmentCards);
          
          // 存储环境牌到房间状态中
          room.environmentCards = environmentCards;
          
          // 广播开始发牌消息给所有玩家
          console.log('广播 gameStarted 消息给所有玩家');
          broadcast({
            type: 'gameStarted',
            players: room.players,
            environmentCards: environmentCards
          });
          
          // 广播开始发牌消息给上帝，让他跳转到 god-panel.html
          console.log('广播 startDealing 消息给所有客户端，让上帝跳转到 god-panel.html');
          broadcast({
            type: 'startDealing'
          });
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
