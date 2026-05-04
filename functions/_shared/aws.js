const encoder = new TextEncoder();

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function awsConfig(env) {
  return {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
    region: env.AWS_REGION || "us-east-1",
    tablePrefix: env.JUNO_TABLE_PREFIX || "juno-crm",
    bucket: env.CLINIC_ARTIFACT_BUCKET || "latitude-clinic-artifacts-557690582398-us-east-1",
  };
}

function assertAwsConfig(config) {
  if (!config.accessKeyId || !config.secretAccessKey) throw new Error("AWS credentials are not configured.");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value);
  return bytesToHex(new Uint8Array(digest));
}

async function hmac(key, value) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)));
}

async function signingKey(secret, date, region, service) {
  const kDate = await hmac(encoder.encode(`AWS4${secret}`), date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function amzDates(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

async function signedFetch(env, { service, method = "POST", url, headers = {}, body = "" }) {
  const config = awsConfig(env);
  assertAwsConfig(config);
  const target = new URL(url);
  const { amzDate, dateStamp } = amzDates();
  const payloadHash = await sha256Hex(body);
  const signedHeaders = {
    host: target.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(config.sessionToken ? { "x-amz-security-token": config.sessionToken } : {}),
    ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
  };
  const signedHeaderNames = Object.keys(signedHeaders).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${String(signedHeaders[name]).trim()}\n`).join("");
  const canonicalQuery = [...target.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join("&");
  const canonicalRequest = [
    method,
    target.pathname || "/",
    canonicalQuery,
    canonicalHeaders,
    signedHeaderNames.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${config.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  const signature = bytesToHex(await hmac(await signingKey(config.secretAccessKey, dateStamp, config.region, service), stringToSign));
  const auth = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;
  return fetch(target.toString(), {
    method,
    headers: {
      ...headers,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...(config.sessionToken ? { "x-amz-security-token": config.sessionToken } : {}),
      Authorization: auth,
    },
    body: method === "GET" || method === "HEAD" ? undefined : body,
  });
}

export function tableName(env, logicalName) {
  return `${awsConfig(env).tablePrefix}-${logicalName}`;
}

export async function dynamo(env, target, payload) {
  const config = awsConfig(env);
  const body = JSON.stringify(payload);
  const response = await signedFetch(env, {
    service: "dynamodb",
    method: "POST",
    url: `https://dynamodb.${config.region}.amazonaws.com/`,
    headers: {
      "content-type": "application/x-amz-json-1.0",
      "x-amz-target": `DynamoDB_20120810.${target}`,
    },
    body,
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(json.message || json.__type || `DynamoDB ${target} failed.`);
  return json;
}

export function toAttr(value) {
  if (value === null || value === undefined) return { NULL: true };
  if (typeof value === "number") return { N: String(value) };
  if (typeof value === "boolean") return { BOOL: value };
  if (Array.isArray(value)) return { L: value.map(toAttr) };
  if (typeof value === "object") return { M: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toAttr(item)])) };
  return { S: String(value) };
}

export function fromAttr(attr) {
  if (!attr) return undefined;
  if ("S" in attr) return attr.S;
  if ("N" in attr) return Number(attr.N);
  if ("BOOL" in attr) return Boolean(attr.BOOL);
  if ("NULL" in attr) return null;
  if ("L" in attr) return attr.L.map(fromAttr);
  if ("M" in attr) return Object.fromEntries(Object.entries(attr.M).map(([key, value]) => [key, fromAttr(value)]));
  return undefined;
}

export function fromItem(item) {
  return Object.fromEntries(Object.entries(item || {}).map(([key, value]) => [key, fromAttr(value)]));
}

export function toItem(record) {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, toAttr(value)]));
}

export async function getById(env, logicalName, id) {
  const result = await dynamo(env, "GetItem", { TableName: tableName(env, logicalName), Key: { id: { S: id } } });
  return result.Item ? fromItem(result.Item) : null;
}

export async function putRecord(env, logicalName, record) {
  await dynamo(env, "PutItem", { TableName: tableName(env, logicalName), Item: toItem(record) });
  return record;
}

export async function scanRecords(env, logicalName) {
  const table = tableName(env, logicalName);
  let ExclusiveStartKey = undefined;
  const records = [];
  do {
    const result = await dynamo(env, "Scan", { TableName: table, ...(ExclusiveStartKey ? { ExclusiveStartKey } : {}) });
    records.push(...(result.Items || []).map(fromItem));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return records;
}

export async function queryByIndex(env, logicalName, indexName, attrName, attrValue) {
  const result = await dynamo(env, "Query", {
    TableName: tableName(env, logicalName),
    IndexName: indexName,
    KeyConditionExpression: "#k = :v",
    ExpressionAttributeNames: { "#k": attrName },
    ExpressionAttributeValues: { ":v": toAttr(attrValue) },
  });
  return (result.Items || []).map(fromItem);
}

export async function presignS3Get(env, key, expires = 900) {
  const config = awsConfig(env);
  assertAwsConfig(config);
  const { amzDate, dateStamp } = amzDates();
  const host = `${config.bucket}.s3.${config.region}.amazonaws.com`;
  const path = `/${String(key).split("/").map(encodeRfc3986).join("/")}`;
  const scope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
    ...(config.sessionToken ? { "X-Amz-Security-Token": config.sessionToken } : {}),
  };
  const canonicalQuery = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([keyName, value]) => `${encodeRfc3986(keyName)}=${encodeRfc3986(value)}`)
    .join("&");
  const canonicalRequest = ["GET", path, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256Hex(canonicalRequest)].join("\n");
  const signature = bytesToHex(await hmac(await signingKey(config.secretAccessKey, dateStamp, config.region, "s3"), stringToSign));
  return `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export async function s3HeadBucket(env) {
  const config = awsConfig(env);
  const response = await signedFetch(env, {
    service: "s3",
    method: "HEAD",
    url: `https://${config.bucket}.s3.${config.region}.amazonaws.com/`,
  });
  if (!response.ok) throw new Error(`S3 bucket check failed: ${response.status}`);
  return true;
}
