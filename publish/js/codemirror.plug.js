
function CodeMirrorPlug(editor){client.notmychange=false;var extenditor={applydiff:function(change,editor){for(var i=0,from={'line':0,'ch':0},to={'line':0,'ch':0};i<change.length;i++){if(change[i][0]==1){editor.replaceRange(change[i][1],from);}
to.ch+=change[i][1].length;var rest=change[i][1].length-editor.getRange(from,to).length;while(rest>0){if(to.line++>editor.lineCount()){console.log('error: delta length inconsistency');break;}
to.ch=rest-1;rest=change[i][1].length-editor.getRange(from,to).length;}
if(change[i][0]==-1){editor.replaceRange('',from,to);to.line=from.line;to.ch=from.ch;}else{from.line=to.line;from.ch=to.ch;}}}}
return getPlugger(function onnewcontent(content){client.notmychange=true;editor.setValue(content);return editor.getValue();},function onnewdiff(diff){client.notmychange=true;extenditor.applydiff(diff,editor);return editor.getValue();});}