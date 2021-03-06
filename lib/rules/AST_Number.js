/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * A numeric literal.
 *
 * @module rules/AST_Number
 * @see ECMA-262 Spec Chapter 11.1.3
 */

/**
 * @event module:rules/AST_Number.rule
 * @property {string} ruleName The string 'AST_Number'
 * @property {module:AST.node} ast The AST node that is an instance of this rule
 * @property {string} file The file that the rule begins on.
 * @property {number} line The line of the file where the rule begins on.
 * @property {number} column The column of the file where the rule begins on.
 * @property {boolean} processingComplete Indicates whether the rule has been processed yet or not. This can be used to
 *		determine if this is the pre-evalutation event or the post-evaluation event.
 * @property {module:base/types/number.NumberType} result The evaluated number. Only available post-evaluation.
 */

var AST = require('../AST'),
	RuleProcessor = require('../RuleProcessor'),
	Base = require('../Base');

AST.registerRuleProcessor('AST_Number', function processRule() {

	var result;

	RuleProcessor.preProcess(this);

	RuleProcessor.fireRuleEvent(this, {}, false);
	RuleProcessor.logRule('AST_Number', this.value);

	result = new Base.NumberType(this.value);

	RuleProcessor.fireRuleEvent(this, {
		result: result
	}, true);

	RuleProcessor.postProcess(this, result);

	return result;
});