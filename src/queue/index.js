class MemoryQueue {
  constructor() {
    this.queue = [];
  }
  
  push(job) {
    this.queue.push({
      id: Date.now() + Math.floor(Math.random() * 1000),
      attempts: 0,
      maxAttempts: 3,
      ...job
    });
  }
  
  shift() {
    return this.queue.shift();
  }
  
  splice(start, count) {
      return this.queue.splice(start, count);
  }
  
  length() {
    return this.queue.length;
  }
  
  getAll() {
      return this.queue;
  }
}

const orderQueue = new MemoryQueue();
const statusQueue = new MemoryQueue();
const refillQueue = new MemoryQueue();

module.exports = { orderQueue, statusQueue, refillQueue };
