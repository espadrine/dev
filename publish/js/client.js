
(function(){window.console=console?console:{log:function(){for(var arg in arguments)
console.data=(console.data?console.data:'')+arg+' ';console.data+='\n';}}
var dmp=new diff_match_patch();window.client={user:+(new Date()),rev:0,lastcopy:"<!doctype html>\n<title><\/title>\n\n<body>\n  <canvas id=tutorial width=150 height=150><\/canvas>\n\n  <script>\n    var canvas = document.getElementById('tutorial');\n    var context = canvas.getContext('2d');\n\n    context.fillStyle = 'rgb(250,0,0)';\n    context.fillRect(10, 10, 55, 50);\n\n    context.fillStyle = 'rgba(0, 0, 250, 0.5)';\n    context.fillRect(30, 30, 55, 50);\n  <\/script>\n<\/body>",delta:[],notmychange:false};window.editor=new CodeMirror(document.body,{value:window.client.lastcopy,height:"100%",width:"50%",mode:"text/html",tabMode:"indent",onChange:function(){if(client.notmychange){client.notmychange=false;}else{var newdiff=dmp.diff_main(client.lastcopy,editor.getValue());if(newdiff.length>2){dmp.diff_cleanupSemantic(newdiff);dmp.diff_cleanupEfficiency(newdiff);}
if(newdiff.length!==1||newdiff[0][0]!==DIFF_EQUAL){client.lastcopy=editor.getValue();Scout.send(sending(decodeURI(dmp.diff_toDelta(newdiff)).replace('%','%25')))();}}},});Scout.send(function(xhr,params){params.open.url='/$data';params.data.user=client.user;params.resp=function(xhr,resp){console.log('got content');client.notmychange=true;editor.setValue(resp.data);Scout2.send(getmodif)();};})();window.onunload=function(){Scout.send(function(xhr,params){params.open.url='/$kill';params.data.user=client.user;})();};window.extenditor={applypatch:function(patch,editor){var content=editor.getValue();var futurecontent=dmp.patch_apply(patch,content)[0];var change=dmp.diff_main(content,futurecontent);for(var i=0,from={'line':0,'ch':0},to={'line':0,'ch':0};i<change.length;i++){if(change[i][0]==1){editor.replaceRange(change[i][1],from);}
to.ch+=change[i][1].length;var rest=change[i][1].length-editor.getRange(from,to).length;while(rest>0){to.line++;to.ch=rest-1;rest=change[i][1].length-editor.getRange(from,to).length;}
if(change[i][0]==-1){editor.replaceRange('',from,to);to.line=from.line;to.ch=from.ch;}else{from.line=to.line;from.ch=to.ch;}}}};var Scout2=Scout.maker();function sync(client,delta,workingcopy,applylocally,send){var lastcopydiff=dmp.diff_fromDelta(client.lastcopy,delta);var lastcopypatch=dmp.patch_make(client.lastcopy,lastcopydiff);client.lastcopy=dmp.patch_apply(lastcopypatch,client.lastcopy)[0];workingcopy=applylocally(lastcopypatch);var newdiff=dmp.diff_main(client.lastcopy,workingcopy);if(newdiff.length>2){dmp.diff_cleanupSemantic(newdiff);dmp.diff_cleanupEfficiency(newdiff);}
client.lastcopy=workingcopy;if(newdiff.length!==1||newdiff[0][0]!==DIFF_EQUAL){send(decodeURI(dmp.diff_toDelta(newdiff)).replace('%','%25'));}}
function getmodif(xhr,params){params.open.url='/$dispatch';params.data.user=client.user;console.log('dispatched');params.resp=function receiving(xhr,resp){console.log('received rev : '+resp.rev+', delta : '+JSON.stringify(resp.delta));sync(client,resp.delta,editor.getValue(),function applylocally(patch){client.notmychange=true;extenditor.applypatch(patch,editor);return editor.getValue();},function sendnewdelta(delta){Scout.send(sending(delta))();});Scout2.send(getmodif)();};params.error=function receiveerror(xhr,status){console.log('getmodif xhr error: status',status);var now=+new Date();if(status===0&&now-lastnetworkissue>5000){lastnetworkissue=now;Scout2=Scout.maker();Scout2.send(getmodif)();}else{console.log('connection lost.');}};}
var lastnetworkissue=0;function sending(delta){return function(xhr,params){if(delta.length===0){return;}
params.data={rev:client.rev++,user:client.user,delta:delta};params.open.url='/$new';console.log('sending: '+JSON.stringify(params.data));params.resp=function(){console.log('sent');};params.error=function senderror(xhr,status){console.log('send error: status',JSON.stringify(status));};};}})();