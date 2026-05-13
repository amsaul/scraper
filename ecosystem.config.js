module.exports = {
  apps: [
    {
      name: 'scraper-worker',
      script: './src/workers/mainWorker.ts',
      interpreter: 'tsx',
      instances: 2,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_file: './logs/worker-combined.log',
      time: true,
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'push-worker',
      script: './src/workers/pushWorker.ts',
      interpreter: 'tsx',
      instances: 2,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      error_file: './logs/push-error.log',
      out_file: './logs/push-out.log',
      time: true
    },
    {
      name: 'scheduler',
      script: './src/scheduler.ts',
      interpreter: 'tsx',
      instances: 1,
      watch: false,
      max_memory_restart: '512M',
      error_file: './logs/scheduler-error.log',
      out_file: './logs/scheduler-out.log',
      time: true
    }
  ]
};