const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const { Octokit } = require('@octokit/rest');

const app = express();
const PORT = process.env.PORT || 8080;

// 确保 uploads 目录存在
const ensureDirectoryExistence = async (dir) => {
  try {
    await fs.access(dir);
  } catch (error) {
    await fs.mkdir(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
};

// 初始化 uploads 目录
ensureDirectoryExistence('./uploads');

// 配置文件上传
const storage = multer.diskStorage({
  destination: './uploads',
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

// 配置 multer：限制文件大小为 150MB，支持B站m4s格式
const upload = multer({
  storage: storage,
  limits: { fileSize: 150 * 1024 * 1024 }, // 150MB
  fileFilter: (req, file, cb) => {
    // 视频文件支持mp4、mov、avi、m4s
    if (file.fieldname === 'video' && !file.originalname.match(/\.(mp4|mov|avi|m4s)$/)) {
      return cb(new Error('Only video files (mp4, mov, avi, m4s) are allowed!'), false);
    }
    // 音频文件支持mp3、wav、m4a、m4s
    if (file.fieldname === 'audio' && !file.originalname.match(/\.(mp3|wav|m4a|m4s)$/)) {
      return cb(new Error('Only audio files (mp3, wav, m4a, m4s) are allowed!'), false);
    }
    cb(null, true);
  }
});

// 从环境变量读取配置
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USER = process.env.GITHUB_USER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const API_SECRET_KEY = process.env.API_SECRET_KEY;

// 初始化 Octokit
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// 密钥验证中间件
const authenticateKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey || apiKey !== API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized - Invalid or missing API key' });
  }
  
  next();
};

// 合并视频并上传到GitHub仓库的API
app.post('/merge', authenticateKey, upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'audio', maxCount: 1 }
]), async (req, res) => {
  let videoFilePath, audioFilePath, outputFilePath;
  
  try {
    // 获取上传的文件
    const videoFile = req.files.video[0];
    const audioFile = req.files.audio[0];
    
    videoFilePath = videoFile.path;
    audioFilePath = audioFile.path;
    
    // 生成唯一ID和输出路径
    const uniqueId = uuidv4();
    outputFilePath = `./merged-${uniqueId}.mp4`;
    
    console.log('Starting video merge...');
    
    // 合并视频和音频
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoFile.path)
        .input(audioFile.path)
        .outputOptions([
          '-c:v copy', // 视频流直接复制，不重新编码
          '-c:a aac',  // 音频流编码为AAC，确保兼容性
          '-strict -2', // 允许使用实验性编码器
          '-loglevel error'
        ])
        .output(outputFilePath)
        .on('end', () => {
          console.log('Merge completed successfully');
          resolve();
        })
        .on('error', (err) => {
          console.error('Merge error:', err);
          reject(new Error('Video merge failed: ' + err.message));
        })
        .run();
    });
    
    console.log('Uploading to GitHub...');
    
    // 读取合并后的文件并转换为base64
    const fileContent = await fs.readFile(outputFilePath, 'base64');
    
    // 上传到GitHub仓库
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: GITHUB_USER,
      repo: GITHUB_REPO,
      path: `videos/${uniqueId}.mp4`,
      message: `Add merged video ${uniqueId}`,
      content: fileContent,
      branch: 'main'
    });
    
    // 生成访问URL
    const videoUrl = `https://${GITHUB_USER}.github.io/${GITHUB_REPO}/videos/${uniqueId}.mp4`;
    
    res.json({ 
      status: 'success', 
      message: 'Video merged and uploaded successfully',
      videoUrl: videoUrl
    });
    
  } catch (err) {
    console.error('API Error:', err);
    // 区分不同类型错误，返回更明确的信息
    if (err.message.includes('Only video files') || err.message.includes('Only audio files')) {
      res.status(400).json({ error: err.message });
    } else if (err.message.includes('Video merge failed')) {
      res.status(500).json({ error: 'Video merging process failed: ' + err.message.split(': ').slice(1).join(': ') });
    } else if (err.message.includes('upload to GitHub')) {
      res.status(500).json({ error: 'Failed to upload to GitHub: ' + err.message });
    } else {
      res.status(500).json({ error: err.message || 'An unexpected error occurred' });
    }
  } finally {
    // 确保文件被清理，无论成功还是失败
    try {
      if (videoFilePath) await fs.unlink(videoFilePath);
      if (audioFilePath) await fs.unlink(audioFilePath);
      if (outputFilePath) await fs.unlink(outputFilePath);
      console.log('Temporary files cleaned up');
    } catch (cleanupErr) {
      console.error('Error cleaning up files:', cleanupErr);
    }
  }
});

// 健康检查路由
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'API is running' });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`Video Merge API running on port ${PORT}`);
  console.log('Environment configured:', {
    GITHUB_USER: GITHUB_USER ? 'Set' : 'Not Set',
    GITHUB_REPO: GITHUB_REPO ? 'Set' : 'Not Set',
    API_SECRET_KEY: API_SECRET_KEY ? 'Set' : 'Not Set',
    GITHUB_TOKEN: GITHUB_TOKEN ? 'Set' : 'Not Set'
  });
});
