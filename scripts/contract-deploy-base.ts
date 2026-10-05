/** Explicit testnet deployment. Never uses the known local development key. */
import {type Hex} from 'viem';
import {deployBaseSepolia} from './contract-deploy';
const rpc=process.env.BASE_RPC_URL;
const key=process.env.DEPLOYER_PRIVATE_KEY;
if(!rpc || !key || !/^0x[0-9a-fA-F]{64}$/.test(key))throw new Error('Set BASE_RPC_URL and funded DEPLOYER_PRIVATE_KEY for Base Sepolia (84532)');
console.log(await deployBaseSepolia(rpc,key as Hex));
