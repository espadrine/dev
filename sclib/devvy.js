	
var Camp = require('./camp.js');

Camp.Camp('change', function (query) {
	return {hello: 'world'};
});
	
Camp.Camp.start();
