import { dynamo, s3HeadBucket, tableName } from "../../_shared/aws.js";
import { currentJunoContext, json } from "../../_shared/juno.js";

export async function onRequestGet({ env, request }) {
  const context = await currentJunoContext(env, request);
  if (context.error) return context.error;
  const checks = {};
  try {
    const result = await dynamo(env, "DescribeTable", { TableName: tableName(env, "juno_sessions") });
    checks.dynamodb = { ok: true, table: result.Table?.TableName, status: result.Table?.TableStatus };
  } catch (error) {
    checks.dynamodb = { ok: false, error: error.message };
  }
  try {
    await s3HeadBucket(env);
    checks.s3 = { ok: true };
  } catch (error) {
    checks.s3 = { ok: false, error: error.message };
  }
  return json({ ok: Boolean(checks.dynamodb.ok && checks.s3.ok), checks });
}
