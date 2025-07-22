// kafka_to_redis.js
require('dotenv').config();

const { Kafka } = require('kafkajs');
const { createClient } = require('redis');

const kafka = new Kafka({
  brokers: process.env.KAFKA_BROKERS.split(',')
});

const consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_ID });
const producer = kafka.producer();
const topic = process.env.KAFKA_TOPIC;

const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`
});

(async () => {
  try {
    await redisClient.connect();
    console.log('✅ Connected to Redis');

    await consumer.connect();
    await producer.connect();
    console.log('✅ Connected to Kafka');

    await consumer.subscribe({ topic, fromBeginning: true });
    console.log(`📥 Subscribed to topic: ${topic}`);

    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          const value = message.value.toString();
          console.log('📨 Kafka Message:', value);

          const data = JSON.parse(value);
          const uniqueId = data.uniqueId;
          const eventFlag = data.event_flag;

          if (!uniqueId || typeof eventFlag !== 'number') {
            console.warn('⚠️ Missing or invalid uniqueId/event_flag');
            return;
          }

          const key = `imei_${uniqueId}`;
          const currentVal = await redisClient.get(key);
          const isIgnitionOn = (eventFlag & 1024) === 1024;
          const isIgnitionOff = (eventFlag & 4096) === 4096;

          if (currentVal === 'ignition_on') {
            return;
          }

          if (currentVal && currentVal !== 'ignition_on') {
            await producer.send({
              topic,
              messages: [
                { value: JSON.stringify({ imei: uniqueId, status: 'ignition_off' }) }
              ]
            });
            await redisClient.del(key);
            return;
          }

          if (isIgnitionOn) {
            await redisClient.set(key, 'ignition_on');
            await producer.send({
              topic,
              messages: [
                { value: JSON.stringify({ imei: uniqueId, status: 'ignition_on' }) }
              ]
            });
          } else if (isIgnitionOff) {
            await redisClient.set(key, 'ignition_off');
            await producer.send({
              topic,
              messages: [
                { value: JSON.stringify({ imei: uniqueId, status: 'ignition_off' }) }
              ]
            });
          } else {
            console.warn(`⚠️ Unexpected event_flag: ${eventFlag}`);
          }

        } catch (err) {
          console.error('❌ Error processing message:', err);
        }
      }
    });

  } catch (err) {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  }
})();

process.on('SIGINT', async () => {
  console.log('⛔ Gracefully shutting down...');
  await consumer.disconnect();
  await producer.disconnect();
  await redisClient.quit();
  process.exit(0);
});

