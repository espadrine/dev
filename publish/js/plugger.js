
(function(){var debug=true;var console=(console&&debug)?console:{log:function(){for(var arg in arguments)
console.data=(console.data?console.data:'')+arg+' ';console.data+='\n';}};var dmp=new diff_match_patch();window.client={user:+(new Date()),rev:0,copy:'',lastcopy:''};var plug={newcontent:function(content){var newdiff=dmp.diff_main(client.lastcopy,content);if(newdiff.length>2){dmp.diff_cleanupSemantic(newdiff);dmp.diff_cleanupEfficiency(newdiff);}
if(newdiff.length!==1||newdiff[0][0]!==DIFF_EQUAL){client.lastcopy=content;Scout.send(sending(decodeURI(dmp.diff_toDelta(newdiff)).replace('%','%25')))();}}};var givePlug=function(onnewcontent,onnewdiff){if(onnewcontent){plug.onnewcontent=onnewcontent;onnewcontent(client.copy);plug.onnewdiff=onnewdiff;}
return plug;};var Scout2=Scout.maker();function sync(client,delta,workingcopy,applylocally,send){var lastcopydiff=dmp.diff_fromDelta(client.lastcopy,delta);var lastcopypatch=dmp.patch_make(client.lastcopy,lastcopydiff);client.lastcopy=dmp.patch_apply(lastcopypatch,client.lastcopy)[0];workingcopy=applylocally(lastcopypatch);var newdiff=dmp.diff_main(client.lastcopy,workingcopy);if(newdiff.length>2){dmp.diff_cleanupSemantic(newdiff);dmp.diff_cleanupEfficiency(newdiff);}
client.lastcopy=workingcopy;if(newdiff.length!==1||newdiff[0][0]!==DIFF_EQUAL){send(decodeURI(dmp.diff_toDelta(newdiff)).replace('%','%25'));}}
function getmodif(xhr,params){params.open.url='/$dispatch';params.data.user=client.user;console.log('dispatched');params.resp=function receiving(xhr,resp){console.log('received rev : '+resp.rev+', delta : '+JSON.stringify(resp.delta));sync(client,resp.delta,client.copy,function applylocally(patch){var futurecontent=dmp.patch_apply(patch,client.copy)[0];var change=dmp.diff_main(client.copy,futurecontent);client.copy=(plug.onnewdiff?plug.onnewdiff(change):plug.onnewcontent(futurecontent));return client.copy;},function sendnewdelta(delta){Scout.send(sending(delta))();});Scout2.send(getmodif)();};params.error=function receiveerror(xhr,status){console.log('getmodif xhr error: status',status);var now=+new Date();if(status===0&&now-lastnetworkissue>5000){lastnetworkissue=now;Scout2=Scout.maker();Scout2.send(getmodif)();}else{console.log('connection lost.');}};}
var lastnetworkissue=0;function sending(delta){return function(xhr,params){if(delta.length===0){return;}
params.data={rev:client.rev++,user:client.user,delta:delta};params.open.url='/$new';console.log('sending: '+JSON.stringify(params.data));params.resp=function(){console.log('sent');};params.error=function senderror(xhr,status){console.log('send error: status',JSON.stringify(status));};};}
Scout.send(function(xhr,params){params.open.url='/$data';params.data.user=client.user;params.resp=function(xhr,resp){console.log('got content');client.copy=client.lastcopy=resp.data;Scout2.send(getmodif)();};})();window.onunload=function(){Scout.send(function(xhr,params){params.open.url='/$kill';params.data.user=client.user;})();};window.getPlug=givePlug;})();