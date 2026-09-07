module.exports = {
  apps: [
    {
      name: 'voxaria-api',
      script: 'index.js',
      cwd: 'C:\\Bot\\MusicBot',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'development', PORT: 3002 },
      env_production: { NODE_ENV: 'production', PORT: 3002 },
      error_file: './logs/api-error.log',
      out_file: './logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 5000,
      listen_timeout: 8000
    },
    {
      name: 'voxaria-karaoke',
      script: 'src/workers/start-worker.js',
      cwd: 'C:\\Bot\\MusicBot',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'development' },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      restart_delay: 10000,
      max_restarts: 5,
      min_uptime: '30s'
    }
  ]
};