const fs=require('fs');
class InputFile{ static fromPath(p,name){ const f=new InputFile(); f.path=p; f.name=name; return f; } }
module.exports={InputFile};
