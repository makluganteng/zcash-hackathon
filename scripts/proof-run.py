#!/usr/bin/env python3
"""Generate a real ZK proof. Input JSON is private; bundle contains only public data.
Usage: python3 scripts/proof-run.py private-input.json output-directory
Input: {rulesHash,reserve,maxAmount,bids:[{bidder,commitment,amount,nonce}]}
The caller must read rules and the COMPLETE ordered bids from the confirmed registry.
"""
import hashlib,json,os,pathlib,subprocess,sys,tempfile,time
ROOT=pathlib.Path(__file__).resolve().parents[1]
def run(input_path,output_path):
    data=json.loads(pathlib.Path(input_path).read_text());bids=data['bids'];count=len(bids)
    if count>16: raise ValueError('Capacity exceeded')
    domain=bytes.fromhex(data['rulesHash'][2:]);reserve=int(data['reserve']);maximum=int(data['maxAmount'])
    amounts=[];identities=[];commitments=[];nonces=[]
    for b in bids:
        amount=int(b['amount']);nonce=bytes.fromhex(b['nonce'][2:]);identity=int(b['bidder'],16)
        if not 0<amount<=maximum or len(nonce)!=32 or not 0<identity<2**160: raise ValueError('Invalid opening')
        commitment=hashlib.sha256(domain+identity.to_bytes(20,'big')+amount.to_bytes(8,'big')+nonce).hexdigest()
        if commitment!=b['commitment'][2:].lower(): raise ValueError('Commitment mismatch; cannot skip registered bids')
        amounts.append(amount);identities.append(identity);commitments.append(bytes.fromhex(commitment));nonces.append(list(nonce))
    eligible=[i for i,a in enumerate(amounts) if a>=reserve]
    winner=max(eligible,key=lambda i:amounts[i]) if eligible else 0
    result=dict(sale=bool(eligible),winnerIndex=winner,winnerIdentity='0x'+(identities[winner] if eligible else 0).to_bytes(20,'big').hex(),price=str(amounts[winner] if eligible else 0))
    amounts += [0]*(16-count);identities += [0]*(16-count);commitments += [bytes(32)]*(16-count);nonces += [[0]*32 for _ in range(16-count)]
    p=dict(domain_hi=str(int.from_bytes(domain[:16],'big')),domain_lo=str(int.from_bytes(domain[16:],'big')),reserve=str(reserve),max_amount=str(maximum),count=str(count),identities=list(map(str,identities)),commitment_hi=[str(int.from_bytes(x[:16],'big')) for x in commitments],commitment_lo=[str(int.from_bytes(x[16:],'big')) for x in commitments],sale=result['sale'],winner_index=str(winner),winner_identity=str(int(result['winnerIdentity'],16)),price=result['price'],amounts=list(map(str,amounts)),nonces=[[str(x) for x in n] for n in nonces])
    output=pathlib.Path(output_path).resolve();output.mkdir(parents=True,exist_ok=True)
    # Isolated temporary witness avoids cross-auction races and persistent private Prover.toml files.
    with tempfile.TemporaryDirectory(prefix='private-auction-proof-') as tmp:
        temp=pathlib.Path(tmp);(temp/'Prover.toml').write_text('\n'.join(f'{k} = {json.dumps(v)}' for k,v in p.items())+'\n');os.chmod(temp/'Prover.toml',0o600)
        (temp/'Nargo.toml').write_text((ROOT/'circuits/auction/Nargo.toml').read_text());(temp/'src').symlink_to(ROOT/'circuits/auction/src',target_is_directory=True)
        subprocess.run([str(ROOT/'.tools/noir/nargo'),'execute'],cwd=temp,check=True,stdout=subprocess.DEVNULL)
        started=time.monotonic()
        subprocess.run([str(ROOT/'.tools/bb/bb'),'prove','-b',str(temp/'target/private_auction.json'),'-w',str(temp/'target/private_auction.gz'),'-o',str(output),'--verifier_target','evm','--write_vk','--verify'],check=True)
    raw=(output/'public_inputs').read_bytes();public_inputs=['0x'+raw[i:i+32].hex() for i in range(0,len(raw),32)]
    bundle=dict(protocol='private-auction-v1',result=result,proof='0x'+(output/'proof').read_bytes().hex(),publicInputs=public_inputs,vkHash='0x'+(output/'vk_hash').read_bytes().hex(),provingSeconds=round(time.monotonic()-started,3))
    (output/'bundle.json').write_text(json.dumps(bundle,indent=2)+'\n')
    print(json.dumps({'bundle':str(output/'bundle.json'),'provingSeconds':bundle['provingSeconds']}))
if __name__=='__main__': run(sys.argv[1],sys.argv[2])
