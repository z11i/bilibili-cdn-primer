// Synthetic MP4 index data. No recordings, accounts, URLs, or network fixtures.
exports.sidx = ({count=3,version=0,firstOffset=0,earliest=0}={}) => {
 const length=(version ? 40:32)+count*12;
 const b=Buffer.alloc(length); b.writeUInt32BE(length,0); b.write('sidx',4);
 b.writeUInt8(version,8); b.writeUInt32BE(1,12); b.writeUInt32BE(1000,16);
 let p=20;
 if(version) {b.writeBigUInt64BE(BigInt(earliest),p); b.writeBigUInt64BE(BigInt(firstOffset),p+8); p+=16;}
 else {b.writeUInt32BE(earliest,p); b.writeUInt32BE(firstOffset,p+4); p+=8;}
 b.writeUInt16BE(count,p+2); p+=4;
 for(let i=0;i<count;i++,p+=12) {b.writeUInt32BE(1000000,p); b.writeUInt32BE(5000,p+4); b.writeUInt32BE(0x90000000,p+8);}
 return b;
};
