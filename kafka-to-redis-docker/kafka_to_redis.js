// kafka_to_redis.js
require('dotenv').config();

const { Kafka } = require('kafkajs');
const { createClient } = require('redis');

const kafka = new Kafka({
  brokers: process.env.KAFKA_BROKERS.split(',')
});

const consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_ID });
const topic = process.env.KAFKA_TOPIC;

const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
});

(async () => {
  try {
    await redisClient.connect();
    console.log('✅ Connected to Redis');

    await consumer.connect();
    console.log('✅ Connected to Kafka');

    await consumer.subscribe({ topic, fromBeginning: true });
    console.log(`📥 Subscribed to topic: ${topic}`);

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        try {
          const key = message.key ? message.key.toString() : `msg:${Date.now()}`;
          const value = message.value.toString();

          console.log('📨 Kafka Message:', value);

          await redisClient.set(key, value);
          console.log(`🔑 Saved to Redis: ${key}`);
        } catch (err) {
          console.error('❌ Error saving message to Redis:', err);
        }
      },
    });
  } catch (err) {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  }
})();

process.on('SIGINT', async () => {
  console.log('⛔ Gracefully shutting down...');
  await consumer.disconnect();
  await redisClient.quit();
  process.exit(0);
});
