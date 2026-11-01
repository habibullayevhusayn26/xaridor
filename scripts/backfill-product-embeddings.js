"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { MongoClient } = require("mongodb");
const { productSearchText } = require("../search-engine");

try {
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const apiKey = (process.env.OPENAI_API_KEY || "").trim();
const mongoUri = (process.env.MONGODB_URI || "").trim();
if (!apiKey || !mongoUri) {
  console.error("OPENAI_API_KEY va MONGODB_URI .env yoki muhitda sozlangan bo'lishi kerak.");
  process.exit(1);
}

const model = "text-embedding-3-small";
const dimensions = 1536;
const categories = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "seed.json"), "utf8")).categories;
const sourceHash = text => crypto.createHash("sha256").update(`${model}\0${text}`).digest("hex");

async function requestEmbeddings(texts) {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts, dimensions, encoding_format: "float" })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload.error?.message || `OpenAI API HTTP ${response.status}`);
  if (!Array.isArray(payload.data) || payload.data.length !== texts.length)
    throw new Error("Embedding API noto'g'ri natija qaytardi.");
  const vectors = payload.data.sort((left, right) => left.index - right.index)
    .map(item => item.embedding);
  if (vectors.some(vector => !Array.isArray(vector) || vector.length !== dimensions ||
      vector.some(value => !Number.isFinite(value))))
    throw new Error("Embedding vektori noto'g'ri formatda.");
  return vectors;
}

async function main() {
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const database = client.db((process.env.MONGODB_DB || "xaridor").trim());
    const collection = database.collection("products");
    const cursor = collection.find({}, {
      projection: { _id: 1, name: 1, cat: 1, tags: 1, descr: 1, searchEmbedding: 1 }
    });
    let batch = [];
    let indexed = 0;
    let skipped = 0;
    const saveBatch = async () => {
      if (!batch.length) return;
      const vectors = await requestEmbeddings(batch.map(item => item.text));
      const now = new Date();
      await collection.bulkWrite(batch.map((item, index) => ({
        updateOne: {
          filter: { _id: item.product._id },
          update: {
            $set: {
              searchEmbedding: { model, hash: item.hash, vector: vectors[index], updatedAt: now }
            }
          }
        }
      })), { ordered: true });
      indexed += batch.length;
      console.log(`Indekslangan: ${indexed}`);
      batch = [];
    };

    for await (const product of cursor) {
      const text = productSearchText(product, categories);
      const hash = sourceHash(text);
      if (product.searchEmbedding?.model === model &&
          product.searchEmbedding?.hash === hash &&
          product.searchEmbedding?.vector?.length === dimensions) {
        skipped++;
        continue;
      }
      batch.push({ product, text, hash });
      if (batch.length >= 32) await saveBatch();
    }
    await saveBatch();
    console.log(`Tayyor. Yangi embedding: ${indexed}; oldindan tayyor: ${skipped}.`);
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error("Mahsulot embeddinglarini yaratib bo'lmadi:", error);
  process.exitCode = 1;
});
