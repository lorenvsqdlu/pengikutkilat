module.exports = {
  apps: [
    {
      name: 'smm-bot',
      script: './src/index.js',
      instances: 1, // Stick to 1 for in-memory queue to work across the app
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 3000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    }
  ]
};
