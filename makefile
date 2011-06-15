# makefile: build and deploy from web/ to publish/, start/stop the server.
# Copyright (c) 2011 Jan Keromnes & Yann Tyl. All rights reserved.

SERVER = server.js
TARGET = publish
SOURCE = web
JSMIN = jsmin
MIN = min

build : clean deploy minify

clean :
	rm -rf $(TARGET)/*

deploy :
	cp -r $(SOURCE)/* $(TARGET)
	
minify :
	for file in `find web -name '*\.js'` ; do cat "$${file}" | $(JSMIN) > "$${file}$(MIN)" ; mv "$${file}$(MIN)" "$${file}" ; done

test :
	cd $(SOURCE) ; sudo node ../$(SERVER)
	
start :
	cd $(TARGET) ; sudo nohup node ../$(SERVER) > ../node.log &
	
stop :
	for pid in `ps aux | grep node | grep $(SERVER) | awk '{print $$2}'` ; do sudo kill $$pid 2> /dev/null ; done

# BONUS

coffee :
	@echo "\n           )      (\n           (  )   )\n         _..,-(--,.._\n      .-;'-.,____,.-';\n     (( |            |\n      \`-;            ;\n         \\          /	\n      .-''\`-.____.-'''-.\n     (     '------'     )\n      \`--..________..--'\n";
	
sandwich :
	@if [ `id -u` = "0" ] ; then echo "\nOKAY." ; else echo "\nWhat? Make it yourself." ; fi
	
