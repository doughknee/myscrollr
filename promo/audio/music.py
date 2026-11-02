"""The film's bed: 120 BPM, A minor, written to the beat grid Film.tsx uses.
Events (seconds): TD 1.5, stocks 3.0, news 4.5, pull-out 5.0, hop 7.5,
push-in 9.0, github 10.5, themes 11.5, end 14.0, out 18.5."""
import numpy as np, wave
SR=48000; DUR=18.5; BPM=120; B=60/BPM
N=int(SR*DUR); t=np.arange(N)/SR
rng=np.random.default_rng(11)
mix=np.zeros(N)
def at(sec): return int(sec*SR)
def add(sig,start):
    i=at(start); n=min(len(sig),N-i)
    if n>0: mix[i:i+n]+=sig[:n]
def env_exp(n,tau): return np.exp(-np.arange(n)/SR/tau)
def lp1(x,fc):
    a=np.exp(-2*np.pi*fc/SR); y=np.empty_like(x); z=0.0
    for i in range(len(x)): z=a*z+(1-a)*x[i]; y[i]=z
    return y
def hp1(x,fc): return x-lp1(x,fc)
def note(f):  # midi-ish helper: f is Hz
    return f
A1,A2,A3=55,110,220; F1,F2=43.65,87.31; C2,C3=65.41,130.81; G1,G2=49,98; E3=164.81; D3=146.83; G3=196
# chords per beat range: (start_beat,end_beat,root,[pad freqs])
chords=[(0,10,A1,[A2,C3,E3,A3]),(10,18,F1,[F2,A2,C3,F2*2]),(18,26,C2,[C3,E3,G3,C3*2]),(26,28,G1,[G2,D3,G3,G2*2]),(28,37,A1,[A2,C3,E3,A3])]
# --- kick
def kick(amp=1.0):
    n=at(.35); x=np.arange(n)/SR
    f=48+110*np.exp(-x*28); ph=2*np.pi*np.cumsum(f)/SR
    return amp*(np.sin(ph)*np.exp(-x*7)+0.4*np.sin(ph*0.5)*np.exp(-x*5))
# --- hat
def hat(amp=.25,dur=.05):
    n=at(dur); return amp*hp1(rng.normal(0,1,n),6000)*np.exp(-np.arange(n)/SR/(dur/3))
# --- pluck (arp)
def pluck(f,amp=.18,dur=.22):
    n=at(dur); x=np.arange(n)/SR
    s=np.sign(np.sin(2*np.pi*f*x))*0.4+np.sin(2*np.pi*f*x)*0.6+0.3*np.sin(2*np.pi*2*f*x)
    return amp*lp1(s,2500)*np.exp(-x*14)
# --- bass 8ths
def bass(f,amp=.5,dur=B/2):
    n=at(dur); x=np.arange(n)/SR
    s=np.sin(2*np.pi*f*x)+0.25*np.sin(2*np.pi*2*f*x)+0.08*np.sign(np.sin(2*np.pi*f*x))
    e=np.minimum(1,x/0.006)*np.exp(-x*5)
    return amp*s*e
# --- pad
def pad(freqs,start,end,amp=.055):
    n=at(end-start); x=np.arange(n)/SR; s=np.zeros(n)
    for f in freqs:
        for det in (-1.5,0,1.5):
            ph=rng.uniform(0,6.28)
            saw=2*((f+det)*x+ph/6.28)%2-1
            s+=saw*0.5+0.5*np.sin(2*np.pi*(f+det)*x+ph)
    s=lp1(s,1100)
    a=np.minimum(1,x/0.6); r=np.minimum(1,(end-start-x)/0.6)
    return amp*s*a*r
for (b0,b1,root,fs) in chords:
    add(pad(fs,b0*B,b1*B),b0*B)
# intro: sparse — kick on beat 0, bass pulse, TD hit at beat 3
add(kick(.9),0)
for b in range(0,6):
    for h in (0,0.5):
        if b*B+h*B<1.5 or b>=3: add(bass(A1 if b<3 else A1,.42),(b+h)*B)
# TD hit: riser + boom + crash
rn=at(.8); add(.12*hp1(rng.normal(0,1,rn),800)*np.linspace(0,1,rn)**2,1.5-.8)
add(kick(1.4),1.5)
cn=at(1.2); add(.22*hp1(rng.normal(0,1,cn),3000)*env_exp(cn,.25),1.5)
# groove from beat 6 to 28
for b in range(6,28):
    add(kick(.95),b*B)
    root=[c for c in chords if c[0]<=b<c[1]][0][2]
    for h in (0,.5):
        add(bass(root,.5),(b+h)*B)
    for h in (0,.25,.5,.75):
        add(hat(.16 if h in (0,.5) else .09),(b+h)*B)
    if b>=10: add(hat(.14,.16),(b+.5)*B)
    if b>=14 and b%2==1: add(np.concatenate([np.zeros(at(.01)),0.5*hp1(rng.normal(0,1,at(.12)),1500)*env_exp(at(.12),.04)]),(b+.5)*B)  # snap on 2&4
# arp 16ths from beat 10 to 28 — A minor pentatonic climbing
scale=[A3,C3*2,D3*2,E3*2,G3*2,A3*2]
k=0
for b in range(10,28):
    for q in range(4):
        f=scale[[0,2,3,5,4,3,2,1][k%8]]
        if b>=18: f*=1.0
        add(pluck(f,.16 if q%2==0 else .11),(b+q/4)*B); k+=1
# UI ticks at swipes/hops (very light)
def tick(amp=.08,f=2600,dur=.03):
    n=at(dur); x=np.arange(n)/SR; return amp*np.sin(2*np.pi*f*x)*np.exp(-x/(dur/4))
for s in (3.0,4.5,10.5): add(tick(),s)
add(tick(.1,1400,.05),7.5)
for i in range(8): add(tick(.05,2000+i*120,.025),11.5+i*0.4)
# end: final chord swell from 14.0, soft kick at 14
add(kick(.8),14.0)
fin=pad([A2,C3,E3,A3,C3*2],14.0,18.5,.075); add(fin,14.0)
# sidechain: duck everything but drums on each kick from beat 6..28
sc=np.ones(N)
for b in list(range(6,28))+[0,3,28]:
    i=at(b*B); n=at(.22)
    if i<N: sc[i:i+n]*= (1-0.55*np.exp(-np.arange(min(n,N-i))/SR/0.07))
# apply sidechain only to pad+bass+arp? Simpler: apply to whole mix lightly
mix*= (0.75+0.25*sc)
# master: soft clip, fade out
mix=np.tanh(mix*1.3)/np.tanh(1.3)
mix*=np.minimum(1,(DUR-t)/1.0)
mix=mix/np.max(np.abs(mix))*0.85
pcm=(np.stack([mix,mix],1)*32767).astype(np.int16)
with wave.open('audio/bed.wav','wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print("ok")
