/**
 * <p>Copyright (c) 2012 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Ti.API implementation
 *
 * @module plugins/TiAPIProcessor
 * @author Bryan Hughes &lt;<a href='mailto:bhughes@appcelerator.com'>bhughes@appcelerator.com</a>&gt;
 */

var path = require('path'),
	Runtime = require(path.join(global.titaniumCodeProcessorLibDir, 'Runtime')),
	Base = require(path.join(global.titaniumCodeProcessorLibDir, 'Base'));

exports.getOverrides = function (options) {
	if (options.globalsOnly) {
		return [];
	}
	var globalObject = Base.getGlobalObject();
	return [{
		regex: /^Titanium\.API\.debug$/,
		callFunction: Base.wrapNativeCall(function callFunction(thisVal, args) {
			return globalObject.get('console').get('debug').callFunction(thisVal, args);
		})
	},{
		regex: /^Titanium\.API\.error$/,
		callFunction: Base.wrapNativeCall(function callFunction(thisVal, args) {
			return globalObject.get('console').get('error').callFunction(thisVal, args);
		})
	},{
		regex: /^Titanium\.API\.info$/,
		callFunction: Base.wrapNativeCall(function callFunction(thisVal, args) {
			return globalObject.get('console').get('info').callFunction(thisVal, args);
		})
	},{
		regex: /^Titanium\.API\.log$/,
		callFunction: Base.wrapNativeCall(function callFunction(thisVal, args) {
			return globalObject.get('console').get('log').callFunction(thisVal, args);
		})
	},{
		regex: /^Titanium\.API\.warn$/,
		callFunction: Base.wrapNativeCall(function callFunction(thisVal, args) {
			return globalObject.get('console').get('warn').callFunction(thisVal, args);
		})
	}];
};