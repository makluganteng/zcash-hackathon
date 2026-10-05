// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IAuctionVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

/// Testnet-only registry. No administrator, upgrades, custody, or result override.
contract PrivateAuction {
    uint256 public constant CAPACITY = 16;
    IAuctionVerifier public immutable verifier;
    uint256 public nextAuctionId = 1;
    bytes32 private constant BID_TYPEHASH = keccak256("Bid(uint256 auctionId,bytes32 rulesHash,address bidder,bytes32 commitment,bytes32 ciphertextHash)");
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    uint256 private constant HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    struct Rules {
        address seller; bytes32 itemHash; bytes32 destinationHash; uint64 reserve; uint64 maxAmount;
        uint64 closesAt; uint32 finalizationWindow; uint32 paymentWindow;
        bytes32 evaluatorKeyHash; bytes32 drandChainHash; uint64 drandRound;
    }
    struct Bid { address bidder; bytes32 commitment; bytes32 ciphertextHash; }
    struct Result { bool sale; uint32 winnerIndex; address winnerIdentity; uint64 price; }
    struct Auction {
        Rules rules; bytes32 rulesHash; uint32 count; uint8 status;
        uint32 winnerIndex; address winnerIdentity; uint64 price; uint64 finalizedAt;
    }
    mapping(uint256 => Auction) private auctions;
    mapping(uint256 => Bid[]) private bids;
    mapping(uint256 => mapping(address => bool)) private admitted;
    event AuctionCreated(uint256 indexed auctionId, address indexed seller, bytes32 rulesHash);
    event BidRegistered(uint256 indexed auctionId,uint32 index,address indexed bidder,bytes32 commitment,bytes32 ciphertextHash);
    event AuctionFinalized(uint256 indexed auctionId,bool sale,uint32 winnerIndex,address winnerIdentity,uint64 price);
    event AuctionExpired(uint256 indexed auctionId);
    error InvalidRules(); error UnknownAuction(); error Closed(); error CapacityReached(); error InvalidBid();
    error InvalidSignature(); error NotReady(); error AlreadyTerminal(); error InvalidProof();
    constructor(address verifier_) {
        require(verifier_.code.length != 0,"Verifier must be deployed");
        verifier = IAuctionVerifier(verifier_);
    }
    function createAuction(Rules calldata rules) external returns(uint256 id) {
        if(rules.seller != msg.sender || rules.closesAt <= block.timestamp || rules.reserve > rules.maxAmount || rules.maxAmount == 0 || rules.finalizationWindow == 0 || rules.paymentWindow == 0 || rules.destinationHash == 0 || rules.evaluatorKeyHash == 0 || rules.drandChainHash == 0 || rules.drandRound == 0) revert InvalidRules();
        id = nextAuctionId++;
        Auction storage a=auctions[id]; a.rules=rules;
        a.rulesHash=keccak256(abi.encode(block.chainid,address(this),id,rules));
        emit AuctionCreated(id,rules.seller,a.rulesHash);
    }
    function getAuction(uint256 id) external view returns(Auction memory) { _known(id); return auctions[id]; }
    function getBids(uint256 id) external view returns(Bid[] memory) { _known(id); return bids[id]; }
    function domainSeparator() public view returns(bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH,keccak256("PrivateAuction"),keccak256("1"),block.chainid,address(this)));
    }
    function registerBid(uint256 id,address bidder,bytes32 commitment,bytes32 ciphertextHash,bytes calldata signature) external {
        _known(id); Auction storage a=auctions[id];
        if(block.timestamp >= a.rules.closesAt) revert Closed();
        if(a.count >= CAPACITY) revert CapacityReached();
        if(bidder == address(0) || commitment == 0 || ciphertextHash == 0 || admitted[id][bidder]) revert InvalidBid();
        bytes32 digest=keccak256(abi.encodePacked("\x19\x01",domainSeparator(),keccak256(abi.encode(BID_TYPEHASH,id,a.rulesHash,bidder,commitment,ciphertextHash))));
        if(signature.length != 65) revert InvalidSignature();
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(signature.offset) s := calldataload(add(signature.offset,32)) v := byte(0,calldataload(add(signature.offset,64))) }
        if(uint256(s)>HALF_ORDER || (v!=27 && v!=28) || ecrecover(digest,v,r,s)!=bidder) revert InvalidSignature();
        admitted[id][bidder]=true;
        bids[id].push(Bid(bidder,commitment,ciphertextHash));
        emit BidRegistered(id,a.count++,bidder,commitment,ciphertextHash);
    }
    /// Constructs all verifier inputs from immutable rules and the complete ordered registry.
    function publicInputs(uint256 id,Result calldata result) public view returns(bytes32[] memory p) {
        _known(id); Auction storage a=auctions[id]; p=new bytes32[](57);
        p[0]=bytes32(uint256(a.rulesHash)>>128); p[1]=bytes32(uint256(uint128(uint256(a.rulesHash))));
        p[2]=bytes32(uint256(a.rules.reserve)); p[3]=bytes32(uint256(a.rules.maxAmount)); p[4]=bytes32(uint256(a.count));
        for(uint256 i=0;i<a.count;i++) {
            Bid storage b=bids[id][i]; p[5+i]=bytes32(uint256(uint160(b.bidder)));
            p[21+i]=bytes32(uint256(b.commitment)>>128); p[37+i]=bytes32(uint256(uint128(uint256(b.commitment))));
        }
        p[53]=bytes32(uint256(result.sale?1:0)); p[54]=bytes32(uint256(result.winnerIndex));
        p[55]=bytes32(uint256(uint160(result.winnerIdentity))); p[56]=bytes32(uint256(result.price));
    }
    function finalizeAuction(uint256 id,bytes calldata proof,Result calldata result) external {
        _known(id); Auction storage a=auctions[id];
        if(a.status!=0) revert AlreadyTerminal();
        if(block.timestamp<a.rules.closesAt) revert NotReady();
        if(block.timestamp>=uint256(a.rules.closesAt)+a.rules.finalizationWindow) revert Closed();
        if(!verifier.verify(proof,publicInputs(id,result))) revert InvalidProof();
        a.status=result.sale?1:2; a.winnerIndex=result.winnerIndex; a.winnerIdentity=result.winnerIdentity;
        a.price=result.price; a.finalizedAt=uint64(block.timestamp);
        emit AuctionFinalized(id,result.sale,result.winnerIndex,result.winnerIdentity,result.price);
    }
    function expireAuction(uint256 id) external {
        _known(id); Auction storage a=auctions[id];
        if(a.status!=0) revert AlreadyTerminal();
        if(block.timestamp<uint256(a.rules.closesAt)+a.rules.finalizationWindow) revert NotReady();
        a.status=3; emit AuctionExpired(id);
    }
    function _known(uint256 id) private view { if(id==0 || id>=nextAuctionId) revert UnknownAuction(); }
}
