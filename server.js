const express = require('express');
const path = require('path');
const app = express();
const port = 3080;

// 提供静态文件服务
app.use(express.static(path.join(__dirname)));

// 启动服务器
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
