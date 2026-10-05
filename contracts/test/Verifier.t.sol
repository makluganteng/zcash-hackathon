// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {HonkVerifier} from "../src/AuctionVerifier.sol";
interface VmProof { function readFileBinary(string calldata path) external view returns(bytes memory); }
contract VerifierTest {
    VmProof constant vm=VmProof(address(uint160(uint256(keccak256("hevm cheat code")))));
    function testRealProofAndTampering() external {
        HonkVerifier verifier=new HonkVerifier();
        bytes memory proof=vm.readFileBinary("../circuits/auction/target/proof");
        bytes memory raw=vm.readFileBinary("../circuits/auction/target/public_inputs");
        bytes32[] memory inputs=new bytes32[](raw.length/32);
        for(uint i=0;i<inputs.length;i++) { bytes32 value; assembly { value:=mload(add(add(raw,32),mul(i,32))) } inputs[i]=value; }
        require(verifier.verify(proof,inputs),"Valid proof rejected");
        // Every changed public field must invalidate the existing proof.
        uint[8] memory positions=[uint(0),2,4,5,21,53,55,56];
        for(uint i=0;i<positions.length;i++) {
            uint p=positions[i]; bytes32 original=inputs[p]; inputs[p]=bytes32(uint(original)+1);
            (bool success,bytes memory result)=address(verifier).staticcall(abi.encodeCall(verifier.verify,(proof,inputs)));
            require(!success || !abi.decode(result,(bool)),"Tampered public input accepted");
            inputs[p]=original;
        }
        proof[proof.length-1]=bytes1(uint8(proof[proof.length-1])^1);
        (bool corruptSuccess,bytes memory corruptResult)=address(verifier).staticcall(abi.encodeCall(verifier.verify,(proof,inputs)));
        require(!corruptSuccess || !abi.decode(corruptResult,(bool)),"Tampered proof accepted");
    }
}
