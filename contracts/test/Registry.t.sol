// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {PrivateAuction} from "../src/PrivateAuction.sol";
interface VmRegistry {
 function addr(uint256 key) external returns(address);
 function sign(uint256 key,bytes32 digest) external returns(uint8,bytes32,bytes32);
 function warp(uint256 time) external;
 function expectRevert(bytes4 selector) external;
}
// Boundary-test fixture ONLY. Real generated verifier is exercised in Verifier.t.sol and contract-smoke.ts.
contract RejectVerifier { function verify(bytes calldata,bytes32[] calldata) external pure returns(bool){return false;} }
contract RegistryTest {
 VmRegistry constant vm=VmRegistry(address(uint160(uint256(keccak256("hevm cheat code")))));
 PrivateAuction registry;
 uint256 id;
 bytes32 constant TYPEHASH=keccak256("Bid(uint256 auctionId,bytes32 rulesHash,address bidder,bytes32 commitment,bytes32 ciphertextHash)");
 function setUp() external {registry=new PrivateAuction(address(new RejectVerifier()));id=registry.createAuction(rules());}
 function rules() internal view returns(PrivateAuction.Rules memory){return PrivateAuction.Rules(address(this),bytes32(uint256(1)),bytes32(uint256(2)),10,100,uint64(block.timestamp+100),200,60,bytes32(uint256(3)),bytes32(uint256(4)),100);}
 function signature(uint256 auction,uint256 key,bytes32 commitment,bytes32 ciphertext) internal returns(bytes memory){
  PrivateAuction.Auction memory a=registry.getAuction(auction);address bidder=vm.addr(key);
  bytes32 digest=keccak256(abi.encodePacked("\x19\x01",registry.domainSeparator(),keccak256(abi.encode(TYPEHASH,auction,a.rulesHash,bidder,commitment,ciphertext))));
  (uint8 v,bytes32 r,bytes32 s)=vm.sign(key,digest);return abi.encodePacked(r,s,v);
 }
 function register(uint256 key) internal {bytes memory sig=signature(id,key,bytes32(key),bytes32(key+100));registry.registerBid(id,vm.addr(key),bytes32(key),bytes32(key+100),sig);}
 function testOrderedPublicInputsContainEntireRegistry() external {
  register(1);register(2);PrivateAuction.Bid[] memory b=registry.getBids(id);require(b.length==2&&b[0].bidder==vm.addr(1)&&b[1].bidder==vm.addr(2));
  bytes32[] memory p=registry.publicInputs(id,PrivateAuction.Result(true,1,vm.addr(2),50));
  require(p.length==57&&uint256(p[4])==2&&uint256(p[5])==uint160(vm.addr(1))&&uint256(p[6])==uint160(vm.addr(2)));
  require(uint256(p[37])==1&&uint256(p[38])==2&&uint256(p[53])==1&&uint256(p[56])==50);
  require(p[7]==0&&p[39]==0);
 }
 function testDuplicateIdentityRejected() external {register(1);bytes memory sig=signature(id,1,bytes32(uint256(2)),bytes32(uint256(3)));vm.expectRevert(PrivateAuction.InvalidBid.selector);registry.registerBid(id,vm.addr(1),bytes32(uint256(2)),bytes32(uint256(3)),sig);}
 function testCiphertextTamperingRejected() external {bytes memory sig=signature(id,1,bytes32(uint256(1)),bytes32(uint256(2)));address bidder=vm.addr(1);vm.expectRevert(PrivateAuction.InvalidSignature.selector);registry.registerBid(id,bidder,bytes32(uint256(1)),bytes32(uint256(3)),sig);}
 function testSignatureAuctionReplayRejected() external {bytes memory sig=signature(id,1,bytes32(uint256(1)),bytes32(uint256(2)));uint256 other=registry.createAuction(rules());address bidder=vm.addr(1);vm.expectRevert(PrivateAuction.InvalidSignature.selector);registry.registerBid(other,bidder,bytes32(uint256(1)),bytes32(uint256(2)),sig);}
 function testDeadlineRejectsAtExactClose() external {bytes memory sig=signature(id,1,bytes32(uint256(1)),bytes32(uint256(2)));address bidder=vm.addr(1);vm.warp(registry.getAuction(id).rules.closesAt);vm.expectRevert(PrivateAuction.Closed.selector);registry.registerBid(id,bidder,bytes32(uint256(1)),bytes32(uint256(2)),sig);}
 function testCapacity16() external {for(uint i=1;i<=16;i++)register(i);bytes memory sig=signature(id,17,bytes32(uint256(17)),bytes32(uint256(117)));address bidder=vm.addr(17);vm.expectRevert(PrivateAuction.CapacityReached.selector);registry.registerBid(id,bidder,bytes32(uint256(17)),bytes32(uint256(117)),sig);}
 function testCannotFinalizeBeforeClose() external {vm.expectRevert(PrivateAuction.NotReady.selector);registry.finalizeAuction(id,"",PrivateAuction.Result(false,0,address(0),0));}
 function testInvalidProofCannotSetWinner() external {vm.warp(registry.getAuction(id).rules.closesAt);vm.expectRevert(PrivateAuction.InvalidProof.selector);registry.finalizeAuction(id,"",PrivateAuction.Result(true,0,address(1),50));require(registry.getAuction(id).status==0);}
 function testExpiryTerminalNoLateProof() external {PrivateAuction.Auction memory a=registry.getAuction(id);vm.warp(uint256(a.rules.closesAt)+a.rules.finalizationWindow);registry.expireAuction(id);require(registry.getAuction(id).status==3);vm.expectRevert(PrivateAuction.AlreadyTerminal.selector);registry.finalizeAuction(id,"",PrivateAuction.Result(false,0,address(0),0));}
 function testCannotExpireEarly() external {vm.expectRevert(PrivateAuction.NotReady.selector);registry.expireAuction(id);}
}
