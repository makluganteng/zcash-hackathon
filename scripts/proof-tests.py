#!/usr/bin/env python3
"""Constraint regression tests through actual Noir witness execution, not JS mirrors."""
import copy,hashlib,json,pathlib,subprocess,tempfile,tomllib
ROOT=pathlib.Path(__file__).resolve().parents[1]
subprocess.run(['python3',str(ROOT/'scripts/proof-fixture.py'),str(ROOT/'circuits/auction/Prover.toml')],check=True)
base=tomllib.loads((ROOT/'circuits/auction/Prover.toml').read_text())
cases=[]
def add(name,changes,success=False):
 p=copy.deepcopy(base);changes(p);cases.append((name,p,success))
def tie(p):
 p['amounts'][0]='500000000'
 domain=int(p['domain_hi']).to_bytes(16,'big')+int(p['domain_lo']).to_bytes(16,'big')
 digest=hashlib.sha256(domain+int(p['identities'][0]).to_bytes(20,'big')+int(p['amounts'][0]).to_bytes(8,'big')+bytes(map(int,p['nonces'][0]))).digest()
 p['commitment_hi'][0]=str(int.from_bytes(digest[:16],'big'));p['commitment_lo'][0]=str(int.from_bytes(digest[16:],'big'))
 p.update(winner_index='0',winner_identity='1',price='500000000')
add('honest three bids',lambda p:None,True)
add('equal top bid uses earliest insertion',tie,True)
add('equal top bid rejects later insertion',lambda p:(tie(p),p.update(winner_index='1',winner_identity='2')))
add('wrong winner',lambda p:p.update(winner_index='2',winner_identity='3',price='300000000'))
add('omitted highest bidder',lambda p:p.update(count='1'))
add('changed amount',lambda p:p['amounts'].__setitem__(1,'400000000'))
add('changed claimant',lambda p:p.update(winner_identity='4'))
add('changed domain',lambda p:p.update(domain_hi='0'))
add('changed reserve without changed result',lambda p:p.update(reserve='600000000'))
add('out of range',lambda p:p.update(max_amount='400000000'))
add('invalid zero amount',lambda p:p['amounts'].__setitem__(1,'0'))
add('canonical below-reserve no-sale',lambda p:p.update(reserve='600000000',sale=False,winner_index='0',winner_identity='0',price='0'),True)
with tempfile.TemporaryDirectory(prefix='auction-circuit-tests-') as temp:
 temp=pathlib.Path(temp);(temp/'src').symlink_to(ROOT/'circuits/auction/src',target_is_directory=True);(temp/'Nargo.toml').write_text((ROOT/'circuits/auction/Nargo.toml').read_text())
 for name,p,success in cases:
  (temp/'Prover.toml').write_text('\n'.join(f'{k} = {json.dumps(v)}' for k,v in p.items()))
  result=subprocess.run([str(ROOT/'.tools/noir/nargo'),'execute'],cwd=temp,capture_output=True)
  if (result.returncode==0)!=success: raise RuntimeError(f'{name}: unexpected outcome\n'+result.stderr.decode())
  print('PASS:',name)
