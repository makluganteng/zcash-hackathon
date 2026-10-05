import test from "node:test";
import assert from "node:assert/strict";
import { endpoint,jsonBody,requireOperator } from "../../src/server/http";
import { configuration } from "../../src/server/config";
test("bounded streaming JSON rejects oversized bodies and invalid content",async()=>{
  const make=(body:string)=>new Request("https://auction.test/api",{method:"POST",headers:{"content-type":"application/json"},body});
  await assert.rejects(jsonBody(make(JSON.stringify({ciphertext:"x".repeat(100)})),20),/upload limit/);
  await assert.rejects(jsonBody(make("{")),/Invalid JSON/);
  assert.deepEqual(await jsonBody(make('{"value":1}')),{value:1});
});
test("private endpoints never expose internal exception messages",async()=>{
  const response=await endpoint(async()=>{throw new Error("private-key-secret database credentials");});
  assert.equal(response.status,503);assert.match(response.headers.get("cache-control")!,/private, no-store/);
  assert.doesNotMatch(await response.text(),/private-key-secret|credentials/);
});
test("operator routes require explicit bearer authorization",()=>{
  const old=process.env.OPERATOR_TOKEN;process.env.OPERATOR_TOKEN="a-long-test-only-token";
  try { assert.throws(()=>requireOperator(new Request("https://auction.test")),/authorization/);assert.throws(()=>requireOperator(new Request("https://auction.test",{headers:{authorization:"Bearer wrong"}})),/authorization/);requireOperator(new Request("https://auction.test",{headers:{authorization:"Bearer a-long-test-only-token"}})); }
  finally {if(old===undefined)delete process.env.OPERATOR_TOKEN;else process.env.OPERATOR_TOKEN=old;}
});
test("public configuration rejects accidental evaluator private key publication",()=>{
  const old=process.env.EVALUATOR_PUBLIC_JWK;process.env.EVALUATOR_PUBLIC_JWK=JSON.stringify({kty:"RSA",d:"never-publish"});
  try {const value=configuration();assert.equal(value.evaluatorPublicKey,null);assert.doesNotMatch(JSON.stringify(value),/never-publish/);assert.equal(value.ready,false);}
  finally {if(old===undefined)delete process.env.EVALUATOR_PUBLIC_JWK;else process.env.EVALUATOR_PUBLIC_JWK=old;}
});
