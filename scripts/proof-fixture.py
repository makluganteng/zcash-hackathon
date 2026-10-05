#!/usr/bin/env python3
"""Public, deterministic test witness. Never use these nonces for actual bids."""
import hashlib,json,pathlib,sys
out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'circuits/auction/Prover.toml')
count=int(sys.argv[2]) if len(sys.argv)>2 else 3
amounts=[(i+1)*100000000 for i in range(count)]+[0]*(16-count)
if count==3: amounts[:3]=[200000000,500000000,300000000]
domain=bytes.fromhex('12'*32)
identities=[i+1 for i in range(count)]+[0]*(16-count)
nonces=[[i+1]*32 for i in range(count)]+[[0]*32 for _ in range(16-count)]
commitments=[hashlib.sha256(domain+identities[i].to_bytes(20,'big')+amounts[i].to_bytes(8,'big')+bytes(nonces[i])).digest() if i<count else bytes(32) for i in range(16)]
best=max(amounts);winner=amounts.index(best) if count else 0
p=dict(domain_hi=str(int.from_bytes(domain[:16],'big')),domain_lo=str(int.from_bytes(domain[16:],'big')),reserve='100000000',max_amount='2100000000000000',count=str(count),identities=list(map(str,identities)),commitment_hi=[str(int.from_bytes(x[:16],'big')) for x in commitments],commitment_lo=[str(int.from_bytes(x[16:],'big')) for x in commitments],sale=bool(count),winner_index=str(winner),winner_identity=str(identities[winner]),price=str(best),amounts=list(map(str,amounts)),nonces=[[str(x) for x in n] for n in nonces])
out.write_text('\n'.join(f'{k} = {json.dumps(v)}' for k,v in p.items())+'\n')
