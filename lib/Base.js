

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * This module contains many base operations used by the code processor. Almost all of the methods and classes strictly
 * implement methods/objects defined in the ECMA-262 specification. Many of the descriptions are taken directly from the
 * ECMA-262 Specification, which can be obtained from
 * <a href='http://www.ecma-international.org/publications/standards/Ecma-262.htm'>ecma international</a> Direct quotes
 * from the ECMA-262 specification are formatted with the prefix 'ECMA-262 Spec:' followed by the quote in
 * <em>italics</em>. See Chapters 8, 9, and 10 in the ECMA-262 specification for more explanations of these objects and
 * methods.
 *
 * @module base
 */
/*global
throwNativeException,
getCurrentContext,
getContextStack
*/

var util = require('util'),

	Runtime = require('./Runtime'),
	RuleProcessor = require('./RuleProcessor'),
	AST = require('./AST'),

	throwTypeError,

	positiveIntegerRegEx = /^\d*$/,

	prototypes = {};

require('es6-shim');

RuleProcessor.setThrowNativeException(throwNativeException);

/*****************************************
 *
 * Non-spec helpers
 *
 *****************************************/

/**
 * Checks if the given value is a primitive type, i.e. {@link module:base.type}(o) is one of 'Number', 'String', 'Boolean',
 * 'Undefined', or 'Null'.
 *
 * @method module:base.isPrimitive
 * @private
 * @param {module:base.BaseType} o The value to check
 * @return {boolean} Whether or not the value is a primitive
 */
function isPrimitive(o) {
	return !!~['Number', 'String', 'Boolean', 'Undefined', 'Null'].indexOf(o && o.className);
}

/**
 * Checks if the given value is an object type (Object, Function, Array, etc)
 *
 * @method module:base.isObject
 * @private
 * @param {module:base.BaseType} o The value to check
 * @return {boolean} Whether or not the value is a primitive
 */
function isObject(o) {
	return !isPrimitive(o);
}

/**
 * Checks if two values are the same
 *
 * @method module:base.sameValue
 * @private
 * @param {module:base.BaseType} x The first type
 * @param {module:base.BaseType} y The second type
 * @return {boolean} Whether or not the values are the same
 */
function sameValue(x, y) {
	if (typeof x === 'undefined' && typeof y === 'undefined') {
		return true;
	}
	if (typeof x === 'undefined' || typeof y === 'undefined') {
		return false;
	}
	if (x.type !== y.type) {
		return false;
	}
	if (x.type === 'Undefined' || x.type === 'Null') {
		return true;
	}
	if (x.type === 'Boolean' || x.type === 'Number' || x.type === 'String') {
		return x.value === y.value;
	}
	return x === y;
}

/**
 * Checks if any of the supplied values are unknown
 *
 * @method module:base.areAnyUnknown
 * @private
 * @param {Array.<module:base.BaseType>} values The values to check for unknown
 * @param {boolean} Whether or not any of the supplied values are unknown
 */
function areAnyUnknown(values) {
	var i, len;
	for (i = 0, len = values.length; i < len; i++) {
		if (type(values[i]) === 'Unknown') {
			return true;
		}
	}
	return false;
}

/**
 * Adds a read-only prop to an object
 *
 * @method module:base.addReadOnlyProperty
 * @private
 * @param {module:base.BaseType} obj The object to add the property to
 * @param {string} name The name of the property
 * @param {module:base.BaseType} value The value of the new property
 */
function addReadOnlyProperty(obj, name, value) {
	obj.defineOwnProperty(name, { value: value }, false, true);
}

/**
 * Adds a non-enumerable but writable prop to an object
 *
 * @method module:base.addNonEnumerableProperty
 * @private
 * @param {module:base.BaseType} obj The object to add the property to
 * @param {string} name The name of the property
 * @param {module:base.BaseType} value The value of the new property
 */
function addNonEnumerableProperty(obj, name, value) {
	obj.defineOwnProperty(name, {
		value: value,
		enumerable: false,
		configurable: true,
		writable: true,
	}, false, true);
}

/**
 * Determines the type of the value.
 *
 * @method module:base.type
 * @param {module:base.BaseType} t The value to check
 * @return {string} The type of the value, one of 'Undefined', 'Null', 'Number', 'String', 'Boolean', 'Object',
 *		'Reference', 'Unknown'.
 */
exports.type = type; // We do the exports first to get docgen to recognize the function properly
function type(t) {
	return t.type;
}

/**
 * Checks if the supplied value is one of the supplied types.
 *
 * @method module:base.isType
 * @param {module:base.BaseType} value The value to check
 * @param {(string | Array.<string>)} types The types to check against
 * @return {boolean} Whether or not the value is one of the types
 */
exports.isType = isType;
function isType(value, types) {
	if (typeof types === 'string') {
		types = [types];
	}
	return types.indexOf(type(value)) !== -1;
}

// ******** Base Type Class ********

/**
 * @classdesc The base class for all types
 *
 * @constructor module:base.BaseType
 * @extends module:Runtime.Evented
 * @param {string} className The name of the class, such as 'String' or 'Object'
 */
exports.BaseType = BaseType;
function BaseType(className) {
	Runtime.Evented.call(this);
	this.className = className;
	this._closure = getCurrentContext();
}
util.inherits(BaseType, Runtime.Evented);

/**
 * Checks if this value is local to an ambiguous context (always true if not in an ambiguous context)
 *
 * @private
 */
BaseType.prototype._isLocal = function () {
	var lexicalEnvironment = getCurrentContext().lexicalEnvironment,
		targetLexicalEnvironment = this._closure.lexicalEnvironment;
	while (lexicalEnvironment) {
		if (targetLexicalEnvironment === lexicalEnvironment) {
			return true;
		} else if (lexicalEnvironment.envRec._ambiguousContext) {
			return false;
		}
		lexicalEnvironment = lexicalEnvironment.outer;
	}
	return true;
};

/**
 * @private
 */
BaseType.prototype._isSkippedLocal = function () {
	var contextStack = getContextStack(),
		targetLexicalEnvironment = this._closure.lexicalEnvironment,
		i;
	for (i = contextStack.length - 1; i >= 0; i--) {
		if (targetLexicalEnvironment === contextStack[i].lexicalEnvironment) {
			return true;
		} else if (contextStack[i].lexicalEnvironment.envRec._skippedModeStack.length) {
			return false;
		}
	}
	return true;
};

/**
 * Updates the closure if this variable is leaked
 *
 * @private
 */
BaseType.prototype._updateClosure = function (targetClosure) {
	var lexicalEnvironment = this._closure.lexicalEnvironment,
		targetLexicalEnvironment = targetClosure.lexicalEnvironment;
	while (lexicalEnvironment) {
		if (lexicalEnvironment === targetLexicalEnvironment) {
			this._closure = targetClosure;
			return true;
		}
		lexicalEnvironment = lexicalEnvironment.outer;
	}
	return false;
};

/**
 * Looks up a property
 *
 * @private
 */
BaseType.prototype._lookupProperty = function (p, alternate) {
	var i, len;
	p = p.toString();
	for (i = 0, len = this._properties.length; i < len; i++) {
		if (this._properties[i].name === p) {
			return alternate ? this._properties[i].alternateValues : this._properties[i].value;
		}
	}
};

/**
 * Adds a property
 *
 * @private
 */
BaseType.prototype._addProperty = function (p, desc) {
	var entry,
		i, len;
	p = p.toString();
	for (i = 0, len = this._properties.length; i < len; i++) {
		if (this._properties[i].name === p) {
			entry =this._properties[i];
			break;
		}
	}
	if (!entry) {
		entry = {
			value: new UndefinedType(),
			alternateValues: {},
			name: p
		};
		this._properties.push(entry);
	}
	if (isLocalSkippedMode() || !this._isSkippedLocal()) {
		entry.alternateValues[getSkippedSection()] = desc;
	} else {
		entry.value = desc;
	}
};

/**
 * Removes a property
 *
 * @private
 */
BaseType.prototype._removeProperty = function (p) {
	var i, len;
	p = p.toString();
	for (i = 0, len = this._properties.length; i < len; i++) {
		if (this._properties[i].name === p) {
			this._properties.splice(i, 1);
			return;
		}
	}
};

/**
 * Gets a list of properties
 *
 * @private
 */
BaseType.prototype._getPropertyNames = function () {
	var i, len,
		properties = [];
	for (i = 0, len = this._properties.length; i < len; i++) {
		properties[i] = this._properties[i].name;
	}
	return properties;
};

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the unknown type
 *
 * @module base/types/unknown
 */
/*global
util,
Runtime,
BaseType
*/

/*****************************************
 *
 * Unknown Type Class
 *
 *****************************************/

/**
 * @classdesc Represents an unknown type. Types are considered to be 'unknown' if their value cannot be determined at
 * compile time and are unique to this implementation. There is no equivalent in the ECMA-262 spec.
 *
 * @constructor module:base/types/unknown.UnknownType
 * @param {string} [className] The name of the class, such as 'String' or 'Object'
 * @extends module:base.BaseType
 */
exports.UnknownType = UnknownType;
function UnknownType(className) {
	var currentLocation = Runtime.getCurrentLocation();
	if (Runtime.options.exactMode) {
		throw new Error('Attempted to instantiate an unknown type in exact mode at ' + currentLocation.filename + ':' +
			currentLocation.line);
	}
	BaseType.call(this, className || 'Unknown');
	this.type = 'Unknown';
}
util.inherits(UnknownType, BaseType);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the undefined type
 *
 * @module base/types/undefined
 */
/*global
util,
BaseType
*/

/*****************************************
 *
 * Undefined Type Class
 *
 *****************************************/

/**
 * @classdesc An undefined type.
 *
 * @constructor module:base/types/undefined.UndefinedType
 * @extends module:base.BaseType
 * @param {string} [className] The name of the class, such as 'String' or 'Object'
 * @see ECMA-262 Spec Chapter 8.1
 */
exports.UndefinedType = UndefinedType;
function UndefinedType(className) {
	BaseType.call(this, className || 'Undefined');
	this.type = 'Undefined';
}
util.inherits(UndefinedType, BaseType);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the null type
 *
 * @module base/types/null
 */
/*global
util,
BaseType
*/

/*****************************************
 *
 * Null Type Class
 *
 *****************************************/

/**
 * @classdesc A null type.
 *
 * @constructor module:base/types/null.NullType
 * @extends module:base.BaseType
 * @param {string} [className] The name of the class, such as 'String' or 'Object'
 * @see ECMA-262 Spec Chapter 8.2
 */
exports.NullType = NullType;
function NullType(className) {
	BaseType.call(this, className || 'Null');
	this.type = 'Null';
	this.value = null;
}
util.inherits(NullType, BaseType);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the number type
 *
 * @module base/types/number
 */
/*global
util,
BaseType,
prototypes
*/

/*****************************************
 *
 * Number Type Class
 *
 *****************************************/

/**
 * @classdesc A number type.
 *
 * @constructor module:base/types/number.NumberType
 * @extends module:base.BaseType
 * @param {number} [initialValue] The initial value of the number. Defaults to 0 if omitted
 * @param {string} [className] The name of the class, such as 'String' or 'Object'
 * @see ECMA-262 Spec Chapter 8.5
 */
exports.NumberType = NumberType;
function NumberType(initialValue, className) {

	var proto;

	BaseType.call(this, className || 'Number');

	Object.defineProperty(this, 'objectPrototype', {
		get: function () {
			return proto || prototypes.Number;
		},
		set: function (value) {
			proto = value;
		},
		configurable: true
	});

	this.type = 'Number';
	this.value = typeof initialValue == 'undefined' ? 0 : initialValue;
}
util.inherits(NumberType, BaseType);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the boolean type
 *
 * @module base/types/boolean
 */
/*global
util,
BaseType,
prototypes
*/

/*****************************************
 *
 * Boolean Type Class
 *
 *****************************************/

/**
 * @classdesc A boolean type.
 *
 * @constructor module:base/types/boolean.BooleanType
 * @extends module:base.BaseType
 * @param {boolean} [initialValue] The initial value of the number. Defaults to false if omitted
 * @param {string} [className] The name of the class, such as 'String' or 'Object'
 * @see ECMA-262 Spec Chapter 8.3
 */
exports.BooleanType = BooleanType;
function BooleanType(initialValue, className) {

	var proto;

	BaseType.call(this, className || 'Boolean');

	Object.defineProperty(this, 'objectPrototype', {
		get: function () {
			return proto || prototypes.Boolean;
		},
		set: function (value) {
			proto = value;
		},
		configurable: true
	});

	this.type = 'Boolean';
	this.value = typeof initialValue == 'undefined' ? false : initialValue;
}
util.inherits(BooleanType, BaseType);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the string type
 *
 * @module base/types/string
 */
/*global
util,
NumberType,
ObjectType,
prototypes,
BaseType
*/

/*****************************************
 *
 * String Type Class
 *
 *****************************************/

/**
 * @classdesc A string type.
 *
 * @constructor module:base/types/string.StringType
 * @extends module:base.BaseType
 * @param {string} [initialValue] The initial value of the number. Defaults to '' if omitted
 * @param {string} [className] The name of the class, such as 'String' or 'Object'
 * @see ECMA-262 Spec Chapter 8.4
 */
exports.StringType = StringType;
function StringType(initialValue, className) {

	var proto;

	var value;
	Object.defineProperty(this, 'value', {
		get: function() {
			return value;
		},
		set: function(val) {
			value = val;
			this._addProperty('length', {
				value: new NumberType(value.length)
			});
		}.bind(this)
	});

	ObjectType.call(this, className || 'String');

	Object.defineProperty(this, 'objectPrototype', {
		get: function () {
			return proto || prototypes.String;
		},
		set: function (value) {
			proto = value;
		},
		configurable: true
	});

	this.type = 'String';
	this.value = typeof initialValue == 'undefined' ? '' : initialValue;
}
util.inherits(StringType, BaseType);

/**
 * @private
 * @see ECMA-262 Spec Chapter 15.5.5.2
 */
StringType.prototype._lookupProperty = function _lookupProperty(p) {
	var current = BaseType.prototype._lookupProperty.call(this, p),
		index;
	if (current) {
		return current;
	}

	// Step 5
	index = +p;

	// Step 4
	if (Math.abs(index) + '' !== p) {
		return;
	}

	// Step 7
	if (index >= this.value.length) {
		return;
	}

	// Steps 8-9
	return {
		value: new StringType(this.value[index]),
		enumerable: true,
		writable: true,
		configurable: true
	};
};

/**
 * @private
 */
StringType.prototype._getPropertyNames = function _getPropertyNames() {
	var props = [],
		val = this.value,
		i, len;
	for (i = 0, len = val.length; i < len; i++) {
		props.push(i.toString());
	}
	return props.concat(BaseType.prototype._getPropertyNames.call(this));
};

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the object type
 *
 * @module base/types/object
 */
/*global
UndefinedType,
type,
isCallable,
throwNativeException,
isObject,
isType,
toObject,
BaseType,
prototypes,
util,
UnknownType,
handleRecoverableNativeException,
isPrimitive,
sameValue,
isAmbiguousBlock
*/

/*****************************************
 *
 * Object Type Class
 *
 *****************************************/

// ******** Property Classes ********

/**
 * @classdesc A Data Descriptor represents the interface an object exposes for getting and setting a property via direct
 * assignment.
 *
 * @constructor module:base/types/object.DataPropertyDescriptor
 * @property {module:base.BaseType} value ECMA-262 Spec: <em>The value retrieved by reading the property.</em>
 * @property {boolean} writable ECMA-262 Spec: <em>If false, attempts by ECMAScript code to change the property‘s
 *		[[value]] attribute using [[put]] will not succeed.</em>
 * @property {boolean} get ECMA-262 Spec: <em>If true, the property will be enumerated by a for-in enumeration
 *		(see 12.6.4). Otherwise, the property is said to be non-enumerable.</em>
 * @property {boolean} get ECMA-262 Spec: <em>If false, attempts to delete the property, change the property to be an
 *		accessor property, or change its attributes (other than [[value]]) will fail.</em>
 * @see ECMA-262 Spec Chapter 8.10
 */
exports.DataPropertyDescriptor = DataPropertyDescriptor;
function DataPropertyDescriptor() {
	this.value = new UndefinedType();
	this.writable = false;
	this.enumerable = false;
	this.configurable = false;
}

/**
 * @classdesc An Accessor Descriptor represents the interface an object exposes for getting and setting a property via
 * get and set methods.
 *
 * @constructor module:base/types/object.AccessorPropertyDescriptor
 * @property {module:base.BaseType} get ECMA-262 Spec: <em>If the value is an Object it must be a function Object.
 *		The function‘s [[call]] internal method (8.6.2) is called with an empty arguments list to return the property
 *		value each time a get access of the property is performed.</em>
 * @property {module:base.BaseType} set ECMA-262 Spec: <em>If the value is an Object it must be a function Object. The
 *		function‘s [[call]] internal method (8.6.2) is called with an arguments list containing the assigned value as
 *		its sole argument each time a set access of the property is performed. The effect of a property's [[set]]
 *		internal method may, but is not required to, have an effect on the value returned by subsequent calls to the
 *		property's [[get]] internal method.</em>
 * @property {boolean} enumerable ECMA-262 Spec: <em>If true, the property is to be enumerated by a for-in enumeration
 *		(see 12.6.4). Otherwise, the property is said to be non-enumerable.</em>
 * @property {boolean} configurable ECMA-262 Spec: <em>If false, attempts to delete the property, change the property to
 *		be a data property, or change its attributes will fail.</em>
 * @see ECMA-262 Spec Chapter 8.10
 */
exports.AccessorPropertyDescriptor = AccessorPropertyDescriptor;
function AccessorPropertyDescriptor() {

	this.get = undefined;
	this.set = undefined;
	this.enumerable = false;
	this.configurable = false;
}

// ******** Property Descriptor Query Methods ********

/**
 * Determines if the supplied property descriptor is a data descriptor or not
 *
 * @method module:base/types/object.isDataDescriptor
 * @param {(module:base/types/object.DataPropertyDescriptor | module:base/types/object.AccessorPropertyDescriptor | Object)} desc The property descriptor to test
 * @return {boolean} Whether or not the descriptor is a data descriptor
 * @see ECMA-262 Spec Chapter 8.10.2
 */
exports.isDataDescriptor = isDataDescriptor;
function isDataDescriptor(desc) {
	if (!desc) {
		return false;
	}
	if (typeof desc.value == 'undefined' && typeof desc.writable == 'undefined') {
		return false;
	}
	return true;
}

/**
 * Determines if the supplied property descriptor is an accessor descriptor or not
 *
 * @method module:base/types/object.isAccessorDescriptor
 * @param {(module:base/types/object.DataPropertyDescriptor | module:base/types/object.AccessorPropertyDescriptor | Object)} desc The property descriptor to test
 * @return {boolean} Whether or not the descriptor is an accessor descriptor
 * @see ECMA-262 Spec Chapter 8.10.1
 */
exports.isAccessorDescriptor = isAccessorDescriptor;
function isAccessorDescriptor(desc) {
	if (!desc) {
		return false;
	}
	if (typeof desc.get == 'undefined' && typeof desc.set == 'undefined') {
		return false;
	}
	return true;
}

/**
 * Determines if the supplied property descriptor is a generic descriptor or not
 *
 * @method module:base/types/object.isGenericDescriptor
 * @param {(module:base/types/object.DataPropertyDescriptor | module:base/types/object.AccessorPropertyDescriptor | Object)} desc The property descriptor to test
 * @return {boolean} Whether or not the descriptor is a generic descriptor
 * @see ECMA-262 Spec Chapter 8.10.3
 */
exports.isGenericDescriptor = isGenericDescriptor;
function isGenericDescriptor(desc) {
	if (!desc) {
		return false;
	}
	return !isAccessorDescriptor(desc) && !isDataDescriptor(desc);
}

/**
 * Checks if two descriptions describe the same description.
 *
 * @method module:base/types/object.sameDesc
 * @private
 * @param {(module:base/types/object.DataPropertyDescriptor | module:base/types/object.AccessorPropertyDescriptor)} x The first descriptor
 * @param {(module:base/types/object.DataPropertyDescriptor | module:base/types/object.AccessorPropertyDescriptor)} y The second descriptor
 * @return {boolean} Whether or not the descriptions are the same
 */
exports.sameDesc = sameDesc;
function sameDesc(x, y) {
	if (isDataDescriptor(x) && isDataDescriptor(y)) {
		return x.configurable === y.configurable && x.enumerable === y.enumerable &&
			x.writable === y.writable && sameValue(x.value, y.value);
	} else if (isAccessorDescriptor(x) && isAccessorDescriptor(y)) {
		x.configurable === y.configurable && x.enumerable === y.enumerable &&
			sameValue(x.get, y.get) && sameValue(x.set && y.set);
	} else {
		return false;
	}
}

/**
 * @classdesc An object type. Note: functions are defined as objects, and so are represented by the class.
 *
 * @constructor module:base/types/object.ObjectType
 * @extends module:base.BaseType
 * @param {string} className The name of the class, such as 'String' or 'Object'
 * @param {(module:base.BaseType | undefined)} value The value to base this object off of
 * @param {boolean} dontCreatePrototype Whether or not to attach the Object prototype to this object
 * @see ECMA-262 Spec Chapters 8.6 and 15.2.2
 */
exports.ObjectType = ObjectType;
function ObjectType(className, value, dontCreatePrototype) {

	var proto;

	// Step 1
	if (value && isObject(value)) {
		return value;
	} else if(value && isType(value, ['String', 'Number', 'Boolean'])) {
		return toObject(value);
	}

	// Initialize the instance (Step 5 implicit)
	BaseType.call(this, className || 'Object');

	// Step 4
	Object.defineProperty(this, 'objectPrototype', {
		get: function () {
			return proto || !dontCreatePrototype && prototypes.Object;
		},
		set: function (value) {
			proto = value;
		},
		configurable: true
	});


	// Step 6
	this.extensible = true;

	this.type = 'Object';

	this._properties = [];
}
util.inherits(ObjectType, BaseType);

/**
 * Indicates that a property was referenced (i.e. read).
 *
 * @event module:base/types/object.ObjectType#propertyReferenced
 * @param {string} name The name of the property that was referenced
 * @param {(module:base/types/object.DataPropertyDescriptor | module:base/types/object.AccessorPropertyDescriptor | undefined)} The descriptor
 *		fetched, if it could be found.
 */
/**
 * ECMA-262 Spec: <em>Returns the value of the named property.</em>
 *
 * @method module:base/types/object.ObjectType#get
 * @param {string} p The name of the property to fetch
 * @param {boolean} alternate Whether or not to fetch the alternate values, or the base value
 * @return {module:base.BaseType} The value of the property, or a new instance of
 *		{@link module:base/types/undefined.UndefinedType} if the property does not exist
 * @see ECMA-262 Spec Chapter 8.12.3
 */
ObjectType.prototype.get = function get(p, alternate) {
	var desc = this.getProperty(p, alternate),
		result,
		prop;

	function lookup(desc) {
		if (desc) {
			if (isDataDescriptor(desc)) {
				return desc.value;
			} else {
				return (desc.get && desc.get.className !== 'Undefined' && desc.get.callFunction(this)) || new UndefinedType();
			}
		}
	}

	if (alternate) {
		result = {};
		for (prop in desc) {
			result[prop] = lookup(desc[prop]);
		}
	} else {
		result = lookup(desc);
	}

	this.fireEvent('propertyReferenced', 'Property "' + p + '" was referenced', {
		name: p,
		desc: desc
	});

	return result || new UndefinedType();
};

/**
 * ECMA-262 Spec: <em>Returns the Property Descriptor of the named own property of this object, or undefined if absent.</em>
 *
 * @method module:base/types/object.ObjectType#getOwnProperty
 * @param {string} p The name of the property descriptor to fetch
 * @param {boolean} alternate Whether or not to fetch the alternate values, or the base value
 * @param {boolean} suppressEvent Not used here, simply used as a placeholder for the implementation in TiApiProvieer
 * @return {(module:base/types/object.DataPropertyDescriptor | module:base/types/object.AccessorPropertyDescriptor | undefined)} The
 *		objects property, or undefined if the property does not exist
 * @see ECMA-262 Spec Chapter 8.12.1
 */
ObjectType.prototype.getOwnProperty = function getOwnProperty(p, alternate) {
	var x,
		prop,
		copied;

	function copyDescriptor(desc) {
		var d = {};
		if (isDataDescriptor(desc)) {
			d.value = desc.value;
			d.writable = desc.writable;
		} else {
			d.get = desc.get;
			d.set = desc.set;
		}
		d.enumerable = desc.enumerable;
		d.configurable = desc.configurable;
		return d;
	}

	if (type(this) === 'Unknown') {
		return alternate ? { 1: {
			value: new UnknownType(),
			configurable: false,
			writable: false,
			enumerable: true
		} } : {
			value: new UnknownType(),
			configurable: false,
			writable: false,
			enumerable: true
		};
	}
	x = this._lookupProperty(p, alternate);
	if (x) {
		if (alternate) {
			copied = {};
			for (prop in x) {
				copied[prop] = copyDescriptor(x[prop]);
			}
			return copied;
		} else {
			return copyDescriptor(x);
		}
	}
};

/**
 * ECMA-262 Spec: <em>Returns the fully populated Property Descriptor of the named property of this object, or undefined
 * if absent.</em>
 *
 * @method module:base/types/object.ObjectType#getProperty
 * @param {string} p The name of the property descriptor to fetch
 * @param {boolean} alternate Whether or not to fetch the alternate values, or the base value
 * @return {(module:base/types/object.DataPropertyDescriptor | module:base/types/object.AccessorPropertyDescriptor | undefined)} The objects property,
 *		or undefined if the property does not exist
 * @see ECMA-262 Spec Chapter 8.12.2
 */
ObjectType.prototype.getProperty = function getProperty(p, alternate) {
	var prop = this.getOwnProperty(p, alternate);
	if (prop) {
		return prop;
	}
	return this.objectPrototype && type(this.objectPrototype) != 'Null' && this.objectPrototype != this ?
		this.objectPrototype.getProperty(p, alternate) : undefined;
};

/**
 * Indicates that a property was set (i.e. written).
 *
 * @event module:base/types/object.ObjectType#propertySet
 * @param {string} name The name of the property that was set
 * @param {module:base.BaseType} value The value that was set
 */
/**
 * ECMA-262 Spec: <em>Sets the specified named property to the value of the second parameter. The flag controls failure
 * handling.</em>
 *
 * @method module:base/types/object.ObjectType#put
 * @param {string} p The name of the parameter to set the value as
 * @param {module:base.BaseType} v The value to set
 * @param {boolean} throwFlag Whether or not to throw an exception on error (related to strict mode)
 * @param {boolean} suppressEvent Suppresses the 'propertySet' event (used when setting prototypes)
 * @see ECMA-262 Spec Chapter 8.12.5
 */
ObjectType.prototype.put = function put(p, v, throwFlag, suppressEvent) {

	var canPutP = this.canPut(p),
		ownDesc,
		desc;
	if (canPutP === 'Unknown') {
		return;
	}

	if (!canPutP) {
		if (throwFlag) {
			handleRecoverableNativeException('TypeError', 'Cannot put argument');
			this.defineOwnProperty(p, { value: new UnknownType() }, throwFlag, suppressEvent);
		} else {
			return;
		}
	}

	if (!suppressEvent) {
		this.fireEvent('propertySet', 'Property "' + p + '" was set', {
			name: p,
			value: v
		});
	}

	ownDesc = this.getOwnProperty(p);
	if (isDataDescriptor(ownDesc)) {
		this.defineOwnProperty(p, { value: v }, throwFlag, suppressEvent);
		return;
	}

	desc = this.getProperty(p);
	if (isAccessorDescriptor(desc)) {
		desc.set.callFunction(this, [v]);
	} else {
		this.defineOwnProperty(p, {
			value: v,
			writable: true,
			enumerable: true,
			configurable: true
		}, throwFlag, suppressEvent);
	}
};

/**
 * ECMA-262 Spec: <em>Returns a boolean value indicating whether a [[put]] operation with PropertyName can be performed.</em>
 *
 * @method module:base/types/object.ObjectType#canPut
 * @param {string} p The name of the parameter to test
 * @return {boolean} Whether or not the parameter can be put
 * @see ECMA-262 Spec Chapter 8.12.4
 */
ObjectType.prototype.canPut = function canPut(p) {
	var desc = this.getOwnProperty(p),
		inherited;
	if (desc) {
		if (isAccessorDescriptor(desc)) {
			return desc.set && desc.set.className != 'Undefined';
		} else {
			return desc.writable;
		}
	}

	if (this.objectPrototype && type(this.objectPrototype) == 'Unknown') {
		return 'Unknown';
	}

	if (!this.objectPrototype || type(this.objectPrototype) == 'Null') {
		return this.extensible;
	}

	inherited = this.objectPrototype.getProperty(p);
	if (typeof inherited == 'undefined') {
		return this.extensible;
	}

	if (isAccessorDescriptor(inherited)) {
		return inherited.set && inherited.set.className != 'Undefined';
	} else {
		return this.extensible && inherited.writable;
	}
};

/**
 * ECMA-262 Spec: <em>Returns a boolean value indicating whether the object already has a property with the given name.</em>
 *
 * @method module:base/types/object.ObjectType#hasProperty
 * @param {string} p The name of the parameter to check for
 * @param {boolean} Whether or not the property exists on the object
 * @see ECMA-262 Spec Chapter 8.12.6
 */
ObjectType.prototype.hasProperty = function hasProperty(p) {
	return !!this.getProperty(p);
};

/**
 * Indicates that a property was deleted
 *
 * @event module:base/types/object.ObjectType#propertyDeleted
 * @param {string} name The name of the property referenced
 */
/**
 * ECMA-262 Spec: <em>Removes the specified named own property from the object. The flag controls failure handling.</em>
 *
 * @method module:base/types/object.ObjectType#delete
 * @param {string} p The name of the parameter to delete
 * @param {boolean} throwFlag Whether or not to throw an exception on error (related to strict mode)
 * @return {boolean} Whether or not the object was deleted succesfully
 * @see ECMA-262 Spec Chapter 8.12.7
 */
ObjectType.prototype['delete'] = function objDelete(p, throwFlag) {
	var desc = this.getOwnProperty(p);

	this.fireEvent('propertyDeleted', 'Property "' + p + '" was deleted', {
		name: p
	});

	if (typeof desc == 'undefined') {
		return true;
	}
	if (desc.configurable) {
		this._removeProperty(p);
		return true;
	}
	if (throwFlag) {
		throwNativeException('TypeError', 'Unable to delete "' + p + '"');
	}
	return false;
};

/**
 * ECMA-262 Spec: <em>Returns a default primitive value for the object.</em>
 *
 * @method module:base/types/object.ObjectType#defaultValue
 * @param {string} A hint for the default value, one of 'String' or 'Number.' Any other value is interpreted as 'String'
 * @return {(module:base/types/string.StringType | module:base/types/number.NumberType | module:base/types/undefined.UndefinedType)} The primitive default value
 * @see ECMA-262 Spec Chapter 8.12.8
 */
ObjectType.prototype.defaultValue = function defaultValue(hint) {

	var result;

	function defaultToString() {
		var toString = this.get('toString'),
			str;
		if (type(toString) === 'Unknown') {
			return new UnknownType();
		}
		if (isCallable(toString)) {
			str = toString.callFunction(this);
			if (type(str) === 'Unknown' || isPrimitive(str)) {
				return str;
			}
		}
	}

	function defaultValueOf() {
		var valueOf = this.get('valueOf'),
			val;
		if (type(valueOf) === 'Unknown') {
			return new UnknownType();
		}
		if (isCallable(valueOf)) {
			val = valueOf.callFunction(this);
			if (type(val) === 'Unknown' || isPrimitive(val)) {
				return val;
			}
		}
	}

	if (hint === 'String') {
		result = defaultToString.call(this);
		if (result) {
			return result;
		}
		result = defaultValueOf.call(this);
		if (result) {
			return result;
		}
		handleRecoverableNativeException('TypeError', 'Could not get the default string value');
		return new UnknownType();
	} else {
		result = defaultValueOf.call(this);
		if (result) {
			return result;
		}
		result = defaultToString.call(this);
		if (result) {
			return result;
		}
		handleRecoverableNativeException('TypeError', 'Could not get the default number value');
		return new UnknownType();
	}
};

/**
 * Indicates that a property was defined.
 *
 * @event module:base/types/object.ObjectType#propertyDefined
 * @param {string} name The name of the property referenced
 */
/**
 * ECMA-262 Spec: <em>Creates or alters the named own property to have the state described by a Property Descriptor. The
 * flag controls failure handling.</em>
 *
 * @method module:base/types/object.ObjectType#defineOwnProperty
 * @param {string} p The name of the parameter to delete
 * @param {(module:base/types/object.DataPropertyDescriptor | module:base/types/object.AccessorPropertyDescriptor)} desc The descriptor for the property
 * @param {boolean} throwFlag Whether or not to throw an exception on error (related to strict mode)
 * @param {boolean} suppressEvent Suppresses the 'propertyDefined' event (used when setting prototypes)
 * @return {boolean} Indicates whether or not the property was defined successfully
 * @see ECMA-262 Spec Chapter 8.12.9
 */
ObjectType.prototype.defineOwnProperty = function defineOwnProperty(p, desc, throwFlag, suppressEvent) {
	var current = this.getOwnProperty(p, false, true),
		newProp,
		descKeys = Object.keys(desc),
		i;

	if (isDataDescriptor(desc)) {
		desc.value = desc.value || new UndefinedType();
		desc.value._updateClosure(this._closure);
		if (type(desc.value) === 'Unknown' || !desc.value._isLocal() || isAmbiguousBlock()) {
			newProp = new DataPropertyDescriptor();
			if (typeof desc.configurable != 'undefined') {
				newProp.configurable = desc.configurable;
			}
			if (typeof desc.enumerable != 'undefined') {
				newProp.enumerable = desc.enumerable;
			}
			if (typeof desc.writable != 'undefined') {
				newProp.writable = desc.writable;
			}
			newProp.value = new UnknownType();
			this._addProperty(p, newProp);
			return true;
		}
	}

	if (typeof current == 'undefined' && !this.extensible) {
		if (throwFlag) {
			handleRecoverableNativeException('TypeError', 'Could not define property ' + p + ': object is not extensible');
		}
		return false;
	}

	if (!suppressEvent) {
		this.fireEvent('propertyDefined', 'Property "' + p + '" was defined', {
			name: p
		});
	}

	if (typeof current == 'undefined' && this.extensible) {
		if (isAccessorDescriptor(desc)) {
			newProp = new AccessorPropertyDescriptor();
			if (typeof desc.configurable != 'undefined') {
				newProp.configurable = desc.configurable;
			}
			if (typeof desc.enumerable != 'undefined') {
				newProp.enumerable = desc.enumerable;
			}
			if (typeof desc.get != 'undefined') {
				newProp.get = desc.get;
			}
			if (typeof desc.set != 'undefined') {
				newProp.set = desc.set;
			}
		} else {
			newProp = new DataPropertyDescriptor();
			if (typeof desc.configurable != 'undefined') {
				newProp.configurable = desc.configurable;
			}
			if (typeof desc.enumerable != 'undefined') {
				newProp.enumerable = desc.enumerable;
			}
			if (typeof desc.value != 'undefined') {
				newProp.value = desc.value;
			}
			if (typeof desc.writable != 'undefined') {
				newProp.writable = desc.writable;
			}
		}
		this._addProperty(p, newProp);
		return true;
	}

	if (descKeys.length === 0) {
		return true;
	}

	if (sameDesc(current, desc)) {
		return true;
	}
	if (!current.configurable) {
		if (desc.configurable || (typeof desc.enumerable != 'undefined' && desc.enumerable !== current.enumerable)) {
			if (throwFlag) {
				handleRecoverableNativeException('TypeError', 'Could not define property ' + p +
					': existing property is not configurable and writable mismatch between existing and new property');
			}
			return false;
		}
	}

	if (isGenericDescriptor(desc)) {
		current = desc;
	} else if (isDataDescriptor(desc) !== isDataDescriptor(current)) {
		if (!current.configurable) {
			if (throwFlag) {
				handleRecoverableNativeException('TypeError', 'Could not define property ' + p +
					': descriptor type mismatch between existing and new property');
			}
			return false;
		}

		if (isDataDescriptor(current)) {
			newProp = new AccessorPropertyDescriptor();
			newProp.configurable = current.configurable;
			newProp.enumerable = current.enumerable;
		} else {
			newProp = new DataPropertyDescriptor();
			newProp.configurable = current.configurable;
			newProp.enumerable = current.enumerable;
		}
		current = newProp;
	} else if (isDataDescriptor(desc) && isDataDescriptor(current)) {
		if (!current.configurable && !current.writable) {
			if (desc.writable) {
				if (throwFlag) {
					handleRecoverableNativeException('TypeError', 'Could not define property ' + p +
						': existing property is not configurable and writable mismatch between existing and new property');
				}
				return false;
			}
			if (typeof desc.value != 'undefined' && !sameDesc(desc, current)) {
				if (throwFlag) {
					handleRecoverableNativeException('TypeError', 'Could not define property ' + p +
						': existing property is not configurable and value mismatch between existing and new property');
				}
				return false;
			}
		}
	} else if (isAccessorDescriptor(desc) && isAccessorDescriptor(current)) {
		if (!current.configurable && typeof desc.set != 'undefined') {
			if (!sameValue(desc.set, current.set)) {
				if (throwFlag) {
					handleRecoverableNativeException('TypeError', 'Could not define property ' + p +
						': existing property is not configurable and set mismatch between existing and new property');
				}
				return false;
			}
			if (!sameValue(desc.get, current.get)) {
				if (throwFlag) {
					handleRecoverableNativeException('TypeError', 'Could not define property ' + p +
						': existing property is not configurable and get mismatch between existing and new property');
				}
				return false;
			}
		}
	}
	for (i in descKeys) {
		current[descKeys[i]] = desc[descKeys[i]];
	}
	this._addProperty(p, current);
	return true;
};

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the array type
 *
 * @module base/types/array
 */
/*global
util,
ObjectType,
prototypes,
NumberType,
positiveIntegerRegEx
*/

/*****************************************
 *
 * Array Type Class
 *
 *****************************************/

/**
 * @classdesc An array type.
 *
 * @constructor module:base/types/array.ArrayType
 * @extends module:base/types/object.ObjectType
 * @param {string} [className] The name of the class, such as 'String' or 'Object'
 * @see ECMA-262 Spec Chapters 11.1.4 and 15.4
 */
exports.ArrayType = ArrayType;
function ArrayType(className) {

	var proto;

	ObjectType.call(this, className || 'Array');

	Object.defineProperty(this, 'objectPrototype', {
		get: function () {
			return proto || prototypes.Array;
		},
		set: function (value) {
			proto = value;
		},
		configurable: true
	});

	this._addProperty('length', {
		value: new NumberType(0),
		writable: true,
		enumerable: false,
		configurable: false
	});
}
util.inherits(ArrayType, ObjectType);

/**
 * ECMA-262 Spec: <em>Creates or alters the named own property to have the state described by a Property Descriptor. The
 * flag controls failure handling.</em>
 *
 * @method module:base/types/array.ArrayType#defineOwnProperty
 * @param {string} p The name of the parameter to delete
 * @param {(module:base/types/object.DataPropertyDescriptor | module:base/types/object.AccessorPropertyDescriptor)} desc The descriptor for the property
 * @param {boolean} throwFlag Whether or not to throw an exception on error (related to strict mode)
 * @param {boolean} suppressEvent Suppresses the 'propertyDefined' event (used when setting prototypes)
 * @return {boolean} Indicates whether or not the property was defined successfully
 * @see ECMA-262 Spec Chapter 8.12.9 and 15.4.5.1
 */
ArrayType.prototype.defineOwnProperty = function defineOwnProperty(p) {

	var parsedP;

	// Call the parent method
	ObjectType.prototype.defineOwnProperty.apply(this, arguments);

	// Check if this is an integer, a.k.a. if we need to update the length
	if (positiveIntegerRegEx.test(p)) {
		parsedP = parseInt(p, 10);
		if (parsedP >= this.get('length').value) {
			this._addProperty('length', {
				value: new NumberType(parsedP + 1),
				writable: true,
				enumerable: false,
				configurable: false
			});
		}
	}
};

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the regexp type
 *
 * @module base/types/regexp
 */
/*global
util,
ObjectType,
prototypes,
throwNativeException,
NumberType,
BooleanType,
StringType
*/

/*****************************************
 *
 * RegExp Type Class
 *
 *****************************************/

// ******** RegExp Type Class ********

/**
 * @classdesc A regexp type.
 *
 * @constructor module:base/types/regexp.RegExpType
 * @extends module:base.ObjectType
 * @param {string} pattern The regex pattern
 * @Param {string} flags The regex flags
 * @param {string} [className] The name of the class, such as 'String' or 'Object'
 * @see ECMA-262 Spec Chapters 11.1.4 and 15.4
 */
exports.RegExpType = RegExpType;
function RegExpType(pattern, flags, className) {

	var proto;

	ObjectType.call(this, className || 'RegExp');

	Object.defineProperty(this, 'objectPrototype', {
		get: function () {
			return proto || prototypes.RegExp;
		},
		set: function (value) {
			proto = value;
		},
		configurable: true
	});

	if (typeof pattern != 'undefined') {
		if (Object.prototype.toString.apply(pattern).indexOf('RegExp') !== -1) { // For some reason, pattern instanceof RegExp doesn't work
			this.value = pattern;
			this._pattern = pattern.source;
			this._flags = (pattern.global ? 'g' : '') + (pattern.ignoreCase ? 'i' : '') + (pattern.multiline ? 'm' : '');
		} else {
			try {
				this.value = new RegExp(pattern, flags);
				this._pattern = pattern;
				this._flags = flags;
			} catch(e) {
				throwNativeException('SyntaxError', 'Regular expression pattern is undefined');
			}
		}
		this._refreshPropertiesFromRegExp();
	}
}
util.inherits(RegExpType, ObjectType);

/**
 * @private
 */
RegExpType.prototype._refreshPropertiesFromRegExp = function _refreshPropertiesFromRegExp() {

	var value = this.value;

	this.put('lastIndex', new NumberType(value.lastIndex), false, true);
	this.put('ignoreCase', new BooleanType(value.ignoreCase), false, true);
	this.put('global', new BooleanType(value.global), false, true);
	this.put('multiline', new BooleanType(value.multiline), false, true);
	this.put('source', new StringType(value.source), false, true);
};

/**
 * @private
 */
RegExpType.prototype._refreshRegExpFromProperties = function _refreshRegExpFromProperties() {
	this.value.lastIndex = this.get('lastIndex');
};

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the function type
 *
 * @module base/types/function
 */
/*global
Runtime,
util,
ObjectType,
prototypes,
NumberType,
handleRecoverableNativeException,
type,
UnknownType,
throwNativeException,
throwTypeError,
createFunctionContext,
UndefinedType,
isType,
isAmbiguousBlock,
exitContext,
getModuleContext,
processInSkippedMode
*/

/*****************************************
 *
 * Function Type Classes
 *
 *****************************************/

// ******** Function Type Base Class ********

/**
 * @classdesc The base for functions that are shared by the actual function type, and by native functions
 *
 * @constructor module:base/types/function.FunctionTypeBase
 * @extends module:base/types/function.ObjectType
 * @param {number} length The number of formal parameters
 * @param {string} [className] The name of the class
 * @see ECMA-262 Spec Chapter 13.2
 */
exports.FunctionTypeBase = FunctionTypeBase;
function FunctionTypeBase(length, className) {

	var proto;

	ObjectType.call(this, className || 'Function');

	// Step 4
	Object.defineProperty(this, 'objectPrototype', {
		get: function () {
			return proto || prototypes.Function;
		},
		set: function (value) {
			proto = value;
		},
		configurable: true
	});

	// Step 9
	this.scope = getModuleContext();

	// Steps 10 (implicit) and 11, defaulting to empty (FunctionType overrides it)
	this.formalParameters = [];

	// Step 13
	this.extensible = true;

	// Step 14 and 15
	this.defineOwnProperty('length', {
		value: new NumberType(length),
		writable: false,
		enumerable: false,
		configurable: false
	}, false, true);

	// Step 17
	this.defineOwnProperty('constructor', {
		value: this,
		writable: true,
		enumerable: false,
		configurable: true
	}, false, true);
}
util.inherits(FunctionTypeBase, ObjectType);

/**
 * ECMA-262 Spec: <em>Returns the value of the named property.</em>
 *
 * @method module:base/types/function.FunctionTypeBase#get
 * @param {string} p The name of the property to fetch
 * @param {boolean} alternate Whether or not to fetch the alternate values, or the base value
 * @return {module:base.BaseType} The value of the property, or a new instance of {@link module:base/types/undefined.UndefinedType} if
 *		the property does not exist
 * @see ECMA-262 Spec Chapters 8.12.3 and 15.3.5.4
 */
FunctionTypeBase.prototype.get = function get(p, alternate) {
	var v = ObjectType.prototype.get.call(this, p, alternate);
	if (p === 'caller' && v.className === 'Function' && v.strict) {
		handleRecoverableNativeException('TypeError', 'Invalid identifier ' + p);
		return new UnknownType();
	}
	return v;
};

/**
 * Checks if the function has an instance of v (or something, not exactly sure)
 *
 * @method module:base/types/function.FunctionTypeBase#hasInstance
 * @param {module:base.BaseType} v The value to check against
 * @return {boolean} Whether or not this function has an instance of v
 * @see ECMA-262 Spec Chapter 15.3.5.3
 */
FunctionTypeBase.prototype.hasInstance = function hasInstance(v) {
	var o = this.get('prototype');

	if (type(v) !== 'Object') {
		return false;
	}
	if (type(o) !== 'Object') {
		throwNativeException('TypeError', 'Value is not an object');
	}
	do {
		v = v.objectPrototype;
		if (o === v) {
			return true;
		}
	} while (v && v !== v.objectPrototype);
	return false;
};

/**
 * @classdesc A function object type
 *
 * @constructor module:base/types/function.FunctionType
 * @extends module:base/types/function.FunctionTypeBase
 * @param {Array.<String>} formalParameterList The list of function arguments
 * @param {module:AST.node} ast The parsed body of the function
 * @param {module:base/context~LexicalEnvironment} lexicalEnvironment The lexical environment of the function
 * @param {boolean} strict Whether or not this is a strict mode function
 * @param {string} [className] The name of the class, defaults to 'Function.' This parameter should only be used by a
 *		constructor for an object extending this one.
 * @see ECMA-262 Spec Chapter 13.2
 */
exports.FunctionType = FunctionType;
function FunctionType(formalParameterList, ast, lexicalEnvironment, strict, className) {

	// Steps 3 (implicit), 4, 13, 14, and 15 covered in the parent constructor
	FunctionTypeBase.call(this, formalParameterList ? formalParameterList.length : 0, className);

	// Step 9
	this.scope = lexicalEnvironment;

	// Steps 10 (implicit) and 11
	this.formalParameters = formalParameterList;

	// Step 12
	this.code = ast && ast.body;
	this._ast = ast;

	// Store whether or not this is strict mode for easy access later
	this.strict = strict;

	// Steps 16 and 18
	this.defineOwnProperty('prototype', {
		value: new ObjectType(),
		writable: true,
		enumerable: false,
		configurable: false
	}, false, true);

	// Step 19
	if (strict) {
		this.defineOwnProperty('caller', {
			get: throwTypeError,
			set: throwTypeError,
			enumerable: false,
			configurable: false
		}, false, true);
		this.defineOwnProperty('arguments', {
			get: throwTypeError,
			set: throwTypeError,
			enumerable: false,
			configurable: false
		}, false, true);
	}
}
util.inherits(FunctionType, FunctionTypeBase);

// ******** Function Type Class ********

/**
 * Calls the function
 *
 * @method module:base/types/function.FunctionType#callFunction
 * @param {module:base.BaseType} thisVal The value of <code>this</code> of the function
 * @param (Array.<module:base.BaseType>} args The set of arguments passed in to the function call
 * @param {Object} options The call options
 * @param {boolean} options.ambiguousContext Whether or not to call as an ambiguous function
 * @param {boolean} options.alwaysInvoke When true, ignores the invokeMethods option
 * @return {module:base.BaseType} The return value from the function
 * @see ECMA-262 Spec Chapter 13.2.1
 */
FunctionType.prototype.callFunction = function callFunction(thisVal, args, options) {

	var funcCtx,
		result,
		i, j,
		len,
		inAmbiguousBlock = isAmbiguousBlock();

	if (!Runtime.options.invokeMethods && !(options && options.alwaysInvoke)) {
		result = new UnknownType();
	} else {
		funcCtx = createFunctionContext(this, thisVal, args || []);
		funcCtx.lexicalEnvironment.envRec._ambiguousContext = !!(options && options.isAmbiguousContext) || inAmbiguousBlock;

		// Execute the function body
		try {
			if (!this.code || this.code.length === 0) {
				result = ['normal', new UndefinedType(), undefined];
			} else {
				for (i = 0, len = this.code.length; i < len; i++) {
					try {
						result = this.code[i].processRule();
					} catch(e) {
						if (!RuleProcessor.inRecursionUnroll()) {
							processInSkippedMode(function () {
								for (j = i + 1; j < len; j++) {
									this.code[j].processRule();
								}
							}.bind(this));
						}
						throw e;
					}
					this.code[i]._ambiguousContext = this.code[i]._ambiguousContext || funcCtx.lexicalEnvironment._ambiguousContext;
					if (result && result.length === 3 && result[0] !== 'normal') {
						processInSkippedMode(function () {
							for (j = i + 1; j < len; j++) {
								this.code[j].processRule();
							}
						}.bind(this));
						break;
					}
				}
			}
		} finally {
			// Exit the context
			exitContext();
		}

		// Process the results
		if (result[0] !== 'throw') {
			if (result[0] === 'return') {
				result = result[1];
			} else {
				result = new UndefinedType();
			}
			result = funcCtx._returnIsUnknown ? new UnknownType() : result;
		}
	}

	return result;
};

/**
 * Invoked the method as a constructor
 *
 * @method module:base/types/function.FunctionType#construct
 * @param (Array.<module:base.BaseType>} args The set of arguments passed in to the function call
 * @return {module:base/types/object.ObjectType} The object that was just created, or the return value of the constructor
 * @see ECMA-262 Spec Chapter 13.2.2
 */
FunctionType.prototype.construct = function construct(args) {
	var obj = new ObjectType(),
		proto = this.get('prototype'),
		result;
	obj.extensible = true;

	// Hook up the prototype
	if (isType(proto, ['Object', 'Unknown'])) {
		obj.objectPrototype = proto;
	}

	// Invoke the constructor
	result = this.callFunction(obj, args);

	// Return the result
	if (isType(result, ['Object', 'Unknown'])) {
		return result;
	}
	return obj;
};

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the reference pseudo-type
 *
 * @module base/types/reference
 */
/*global
util,
Runtime,
BaseType,
isType,
type,
handleRecoverableNativeException,
toObject,
UnknownType,
UndefinedType,
isDataDescriptor,
throwNativeException,
isAccessorDescriptor,
getGlobalObject
*/

/*****************************************
 *
 * Reference Type Class
 *
 *****************************************/

/**
 * @classdesc ECMA-262 Spec: <em>The Reference type is used to explain the behaviour of such operators as delete, typeof,
 * and the assignment operators. For example, the left-hand operand of an assignment is expected to produce a reference.
 * The behaviour of assignment could, instead, be explained entirely in terms of a case analysis on the syntactic form
 * of the left-hand operand of an assignment operator, but for one difficulty: function calls are permitted to return
 * references. This possibility is admitted purely for the sake of host objects. No built-in ECMAScript function
 * defined by this specification returns a reference and there is no provision for a user- defined function to return a
 * reference.</em>
 *
 * @constructor module:base/types/reference.ReferenceType
 * @extends module:base.BaseType
 * @see ECMA-262 Spec Chapter 8.7
 */
exports.ReferenceType = ReferenceType;
function ReferenceType(baseValue, referencedName, strictReference) {
	BaseType.call(this, 'Reference');
	this.type = 'Reference';
	this.baseValue = baseValue;
	this.referencedName = referencedName || '';
	this.strictReference = !!strictReference;
}
util.inherits(ReferenceType, BaseType);

/**
 * ECMA-262 Spec: <em>Returns the base value component of the supplied reference.</em>
 *
 * @method module:base/types/reference.getBase
 * @param {module:base/types/reference.ReferenceType} v The reference to get the base of
 * @return {module:base.BaseType} The base value of the reference
 * @see ECMA-262 Spec Chapter 8.7
 */
exports.getBase = getBase;
function getBase(v) {
	return v.baseValue;
}

/**
 * ECMA-262 Spec: <em>Returns the referenced name component of the supplied reference.</em>
 *
 * @method module:base/types/reference.getReferencedName
 * @param {module:base/types/reference.ReferenceType} v The reference to get the name of
 * @return {string} The base value of the reference
 * @see ECMA-262 Spec Chapter 8.7
 */
exports.getReferencedName = getReferencedName;
function getReferencedName(v) {
	return v.referencedName;
}

/**
 * ECMA-262 Spec: <em>Returns the strict reference component of the supplied reference.</em>
 *
 * @method module:base/types/reference.isStrictReference
 * @param {module:base/types/reference.ReferenceType} v The reference to check for strictness
 * @return {boolean} Whether or not the reference is a strict reference
 * @see ECMA-262 Spec Chapter 8.7
 */
exports.isStrictReference = isStrictReference;
function isStrictReference(v) {
	return v.strictReference;
}

/**
 * ECMA-262 Spec: <em>Returns true if the base value is a Boolean, String, or Number.</em>
 *
 * @method module:base/types/reference.hasPrimitiveBase
 * @param {module:base/types/reference.ReferenceType} v The reference to check for a primitive base
 * @return {boolean} Whether or not the reference has a primitive base
 * @see ECMA-262 Spec Chapter 8.7
 */
exports.hasPrimitiveBase = hasPrimitiveBase;
function hasPrimitiveBase(v) {
	return isType(getBase(v), ['Number', 'String', 'Boolean']);
}

/**
 * ECMA-262 Spec: <em>Returns true if either the base value is an object or HasPrimitiveBase(V) is true; otherwise
 * returns false.</em>
 *
 * @method module:base/types/reference.isPropertyReference
 * @param {module:base/types/reference.ReferenceType} v The reference to get the name of
 * @return {boolean} Whether or not the reference is a property reference
 * @see ECMA-262 Spec Chapter 8.7
 */
exports.isPropertyReference = isPropertyReference;
function isPropertyReference(v) {
	return hasPrimitiveBase(v) || type(getBase(v)) === 'Object';
}

/**
 * ECMA-262 Spec: <em>Returns true if the base value is undefined and false otherwise.</em>
 *
 * @method module:base/types/reference.isUnresolvableReference
 * @param {module:base/types/reference.ReferenceType} v The reference to get the name of
 * @return {boolean} Whether or not the reference is an unresolvable reference
 * @see ECMA-262 Spec Chapter 8.7
 */
exports.isUnresolvableReference = isUnresolvableReference;
function isUnresolvableReference(v) {
	return type(getBase(v)) === 'Undefined';
}

/**
 * Gets the value pointed to by the supplied reference.
 *
 * @method module:base/types/reference.getValue
 * @param {module:base/types/reference.ReferenceType} v The reference to get
 * @return {(module:base.BaseType | module:base/types/undefined.UndefinedType)} The value pointed to by the reference, or
 *		UndefinedType if the value could not be retrieved
 * @see ECMA-262 Spec Chapter 8.7.1
 */
exports.getValue = getValue;
function getValue(v, alternate) {

	var base,
		get,
		getThisObj = this,
		set;

	if (type(v) !== 'Reference') {
		return alternate ? {} : v;
	}
	if (isUnresolvableReference(v)) {
		handleRecoverableNativeException('ReferenceError', '"' + v.referencedName + '" is not defined');
		return alternate ? { 1: new UnknownType() } : new UnknownType();
	}

	base = getBase(v);
	if (isPropertyReference(v)) {
		if (hasPrimitiveBase(v)) {
			get = function get(p, alternate) {
				var o = toObject(base),
					desc = o.getProperty(p, alternate);
				if (typeof desc == 'undefined') {
					return alternate ? {} : new UndefinedType();
				}
				function lookup(desc) {
					if (isDataDescriptor(desc)) {
						return desc.value;
					} else {
						return (desc.get && desc.get.className !== 'Undefined' && desc.get.callFunction(this)) || new UndefinedType();
					}
				}
				if (alternate) {
					set = {};
					for (p in desc) {
						set[p] = lookup(desc[p]);
					}
					return set;
				} else {
					return lookup(desc);
				}
			};
		} else {
			get = base.get;
			getThisObj = base;
		}
		return get.call(getThisObj, getReferencedName(v), alternate);
	} else {
		return base.getBindingValue(getReferencedName(v), isStrictReference(v), alternate);
	}
}

/**
 * Puts the supplied value in the reference
 *
 * @method module:base/types/reference.putValue
 * @param {module:base/types/reference.ReferenceType} v The reference to put the value to
 * @param {module:base.BaseType} w The value to set
 * @see ECMA-262 Spec Chapter 8.7.2
 */
exports.putValue = putValue;
function putValue(v, w) {

	var base,
		put,
		putThisObj = this;

	if (type(v) !== 'Reference') {
		throwNativeException('ReferenceError', 'Attempted to put a value to a non-reference');
	}

	base = getBase(v);
	if (isUnresolvableReference(v)) {
		if (isStrictReference(v)) {
			throwNativeException('ReferenceError', v.referencedName + ' is not resolvable');
		}
		getGlobalObject().put(getReferencedName(v), w, false);
		Runtime.fireEvent('undeclaredGlobalVariableCreated', 'Automatically creating global variable ' + v.referencedName, {
			name: v.referencedName
		});
	} else if (isPropertyReference(v)) {
		if (hasPrimitiveBase(v)) {
			put = function put(p, w, throwFlag) {
				var o = toObject(base),
					desc,
					canPutP = o.canPut(p);
				if (canPutP === 'Unknown') {
					o.defineOwnProperty({
						value: new UnknownType(),
						writable: false,
						configurable: false,
						enumerable: true
					});
					return;
				}
				if (!canPutP || isDataDescriptor(o.getOwnProperty(p))) {
					if (throwFlag) {
						handleRecoverableNativeException('TypeError', 'Could not put ' + v.referencedName);
					}
					return;
				}
				desc = o.getProperty(p);
				if (isAccessorDescriptor(desc)) {
					desc.setter.callFunction(base, [w]);
				} else if (throwFlag) {
					handleRecoverableNativeException('TypeError', 'Could not put ' + v.referencedName);
				}
			};
		} else {
			put = base.put;
			putThisObj = base;
		}
		put.call(putThisObj, getReferencedName(v), w, isStrictReference(v));
	} else {
		base.setMutableBinding(getReferencedName(v), w, isStrictReference(v));
	}
}

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the number prototype
 *
 * @module base/prototypes/number
 */
/*global
util,
FunctionTypeBase,
type,
NumberType,
UnknownType,
areAnyUnknown,
handleRecoverableNativeException,
toInteger,
StringType,
toNumber,
ObjectType,
addNonEnumerableProperty,
wrapNativeCall
*/

/*****************************************
 *
 * Number Protoype Class
 *
 *****************************************/

/**
 * toString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.6.4.2
 */
function NumberProtoToStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(NumberProtoToStringFunc, FunctionTypeBase);
NumberProtoToStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var radix = !args || !args[0] || type(args[0]) === 'Undefined' ? new NumberType(10) : args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Make sure this is a number
	if (type(thisVal) !== 'Number') {
		if (type(thisVal) === 'Object' && thisVal.className === 'Number') {
			thisVal = new NumberType(thisVal.primitiveValue);
		} else {
			handleRecoverableNativeException('TypeError', 'Value is not a number or number object');
			return new UnknownType();
		}
	}

	// Parse the radix
	if (radix && type(radix) !== 'Undefined') {
		radix = toInteger(radix).value;
		if (radix < 2 || radix > 36) {
			handleRecoverableNativeException('RangeError', 'Invalid radix value ' + radix);
			return new UnknownType();
		}
	} else {
		radix = undefined;
	}

	// Use the built-in method to perform the toString
	return new StringType(thisVal.value.toString(radix));
});

/**
 * toLocaleString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.6.4.2
 */
function NumberProtoToLocaleStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(NumberProtoToLocaleStringFunc, FunctionTypeBase);
NumberProtoToLocaleStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {

	// Use the built-in method to perform the toLocaleString
	return new StringType(toNumber(thisVal).value.toLocaleString());
});

/**
 * valueOf() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.6.4.2
 */
function NumberProtoValueOfFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(NumberProtoValueOfFunc, FunctionTypeBase);
NumberProtoValueOfFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Make sure this is a number
	if (type(thisVal) === 'Number') {
		return thisVal;
	} else if (type(thisVal) === 'Object' && thisVal.className === 'Number') {
		return new NumberType(thisVal.primitiveValue);
	}
	handleRecoverableNativeException('TypeError', 'Value is not a number object');
	return new UnknownType();
});

/**
 * toFixed() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.6.4.2
 */
function NumberProtoToFixedFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(NumberProtoToFixedFunc, FunctionTypeBase);
NumberProtoToFixedFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var fractionDigits,
		f;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	fractionDigits = args[0];
	f = typeof fractionDigits != 'undefined' ? toInteger(fractionDigits).value : 0;

	// Step 2
	if (f < 0 || f > 20) {
		handleRecoverableNativeException('RangeError', 'Invalid fraction digits value ' + f);
		return new UnknownType();
	}

	// Use the built-in method to perform the toFixed
	return new StringType(toNumber(thisVal).value.toFixed(f));
});

/**
 * toExponential() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.6.4.2
 */
function NumberProtoToExponentialFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(NumberProtoToExponentialFunc, FunctionTypeBase);
NumberProtoToExponentialFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var fractionDigits,
		f;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	fractionDigits = args[0];
	f = typeof fractionDigits != 'undefined' ? toInteger(fractionDigits).value : 0;

	// Step 2
	if (f < 0 || f > 20) {
		handleRecoverableNativeException('RangeError', 'Invalid fraction digits value ' + f);
		return new UnknownType();
	}

	// Use the built-in method to perform the toFixed
	return new StringType(toNumber(thisVal).value.toExponential(f));
});

/**
 * toPrecision() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.6.4.2
 */
function NumberProtoToPrecisionFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(NumberProtoToPrecisionFunc, FunctionTypeBase);
NumberProtoToPrecisionFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var precision,
		p;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	precision = args[0];
	p = typeof precision != 'undefined' ? toInteger(precision).value : 0;

	// Step 2
	if (p < 1 || p > 21) {
		handleRecoverableNativeException('RangeError', 'Invalid precision value ' + p);
		return new UnknownType();
	}

	// Use the built-in method to perform the toFixed
	return new StringType(toNumber(thisVal).value.toPrecision(p));
});

/**
 * @classdesc The prototype for Booleans
 *
 * @constructor module:base/prototypes/number.NumberPrototypeType
 * @see ECMA-262 Spec Chapter 15.6.4
 */
exports.NumberPrototypeType = NumberPrototypeType;
function NumberPrototypeType(className) {
	ObjectType.call(this, className || 'Number');
	this.primitiveValue = 0;

	addNonEnumerableProperty(this, 'toString', new NumberProtoToStringFunc(), false, true);
	addNonEnumerableProperty(this, 'toLocaleString', new NumberProtoToLocaleStringFunc(), false, true);
	addNonEnumerableProperty(this, 'valueOf', new NumberProtoValueOfFunc(), false, true);
	addNonEnumerableProperty(this, 'toFixed', new NumberProtoToFixedFunc(), false, true);
	addNonEnumerableProperty(this, 'toExponential', new NumberProtoToExponentialFunc(), false, true);
	addNonEnumerableProperty(this, 'toPrecision', new NumberProtoToPrecisionFunc(), false, true);
}
util.inherits(NumberPrototypeType, ObjectType);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the boolean prototype
 *
 * @module base/prototypes/boolean
 */
/*global
util,
FunctionTypeBase,
areAnyUnknown,
UnknownType,
type,
StringType,
handleRecoverableNativeException,
BooleanType,
ObjectType,
addNonEnumerableProperty,
wrapNativeCall
*/

/*****************************************
 *
 * Boolean Prototype Class
 *
 *****************************************/

/**
 * toString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.6.4.2
 */
function BooleanProtoToStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(BooleanProtoToStringFunc, FunctionTypeBase);
BooleanProtoToStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Make sure this is a boolean
	if (type(thisVal) !== 'Boolean') {
		if (type(thisVal) === 'Object' && thisVal.className === 'Boolean') {
			return new StringType(thisVal.primitiveValue + '');
		} else {
			handleRecoverableNativeException('TypeError', 'Value is not a boolean or boolean object');
			return new UnknownType();
		}
	} else {
		return new StringType(thisVal.value + '');
	}
});

/**
 * valueOf() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.6.4.2
 */
function BooleanProtoValueOfFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(BooleanProtoValueOfFunc, FunctionTypeBase);
BooleanProtoValueOfFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var b = thisVal;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (type(b) !== 'Boolean') {
		if (type(b) === 'Object' && b.className === 'Boolean') {
			b = new BooleanType(b.primitiveValue);
		} else {
			handleRecoverableNativeException('TypeError', 'Value is not a boolean object');
			return new UnknownType();
		}
	}
	return b;
});

/**
 * @classdesc The prototype for Booleans
 *
 * @constructor module:base/prototypes/boolean.BooleanPrototypeType
 * @see ECMA-262 Spec Chapter 15.6.4
 */
exports.BooleanPrototypeType = BooleanPrototypeType;
function BooleanPrototypeType(className) {
	ObjectType.call(this, className || 'Boolean');
	this.primitiveValue = false;

	addNonEnumerableProperty(this, 'toString', new BooleanProtoToStringFunc(), false, true);
	addNonEnumerableProperty(this, 'valueOf', new BooleanProtoValueOfFunc(), false, true);
}
util.inherits(BooleanPrototypeType, ObjectType);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the string prototype
 *
 * @module base/prototypes/string
 */
/*global
util,
FunctionTypeBase,
areAnyUnknown,
UnknownType,
type,
StringType,
handleRecoverableNativeException,
checkObjectCoercible,
toString,
toInteger,
NumberType,
toNumber,
RegExpType,
NullType,
ArrayType,
isCallable,
UndefinedType,
toUint32,
ObjectType,
addNonEnumerableProperty,
wrapNativeCall
*/

/*****************************************
 *
 * String Prototype Class
 *
 *****************************************/

/**
 * toString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.2
 */
function StringProtoToStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(StringProtoToStringFunc, FunctionTypeBase);
StringProtoToStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Make sure this is a string
	if (type(thisVal) !== 'String') {
		if (type(thisVal) === 'Object' && thisVal.className === 'String') {
			return new StringType(thisVal.primitiveValue + '');
		} else {
			handleRecoverableNativeException('TypeError', 'Value is not a number or number object');
			return new UnknownType();
		}
	} else {
		return new StringType(thisVal.value + '');
	}
});

/**
 * valueOf() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.3
 */
function StringProtoValueOfFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(StringProtoValueOfFunc, FunctionTypeBase);
StringProtoValueOfFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (thisVal.className !== 'String') {
		handleRecoverableNativeException('TypeError', 'Value is not a string');
		return new UnknownType();
	}
	if (thisVal.hasOwnProperty('primitiveValue')) {
		return new StringType(thisVal.primitiveValue);
	} else {
		return new StringType(thisVal.value);
	}
});

/**
 * charAt() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.4
 */
function StringProtoCharAtFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(StringProtoCharAtFunc, FunctionTypeBase);
StringProtoCharAtFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	var pos = args[0],
		s,
		position;

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal);

	// Step 3
	position = toInteger(pos);

	// Steps 4-6
	return new StringType(s.value.charAt(position.value));
});

/**
 * charCodeAt() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.5
 */
function StringProtoCharCodeAtFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(StringProtoCharCodeAtFunc, FunctionTypeBase);
StringProtoCharCodeAtFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var pos = args[0],
		s,
		position;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal);

	// Step 3
	position = toInteger(pos);

	// Steps 4-6
	return new NumberType(s.value.charCodeAt(position.value));
});

/**
 * concat() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.6
 */
function StringProtoConcatFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(StringProtoConcatFunc, FunctionTypeBase);
StringProtoConcatFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	var s,
		i, len;

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal).value;

	// Step 3 (deep copy args and convert to values)
	args = [].concat(args);
	for (i = 0, len = args.length; i < len; i++) {
		args[i] = toString(args[i]).value;
	}

	// Steps 4-6
	return new StringType(s.concat.apply(s, args));
});

/**
 * indexOf() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.7
 */
function StringProtoIndexOfFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(StringProtoIndexOfFunc, FunctionTypeBase);
StringProtoIndexOfFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var searchString = args[0],
		position = args[2],
		s,
		searchStr,
		pos;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal).value;

	// Step 3
	searchStr = toString(searchString).value;

	// Step 4
	pos = typeof position != 'undefined' ? toInteger(position).value : 0;

	// Steps 5-8
	return new NumberType(s.indexOf(searchStr, pos));
});

/**
 * lastIndexOf() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.8
 */
function StringProtoLastIndexOfFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(StringProtoLastIndexOfFunc, FunctionTypeBase);
StringProtoLastIndexOfFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var searchString = args[0],
		position = args[2],
		s,
		searchStr,
		pos;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal).value;

	// Step 3
	searchStr = toString(searchString).value;

	// Step 4
	pos = typeof position != 'undefined' ? toNumber(position).value : undefined;

	// Steps 5-8
	return new NumberType(s.lastIndexOf(searchStr, pos));

});

/**
 * localeCompare() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.9
 */
function StringProtoLocaleCompareFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(StringProtoLocaleCompareFunc, FunctionTypeBase);
StringProtoLocaleCompareFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var that = args[0],
		s;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal).value;

	// Step 3
	that = toString(that).value;

	return new NumberType(s.localeCompare(that));
});

/**
 * match() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.10
 */
function StringProtoMatchFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(StringProtoMatchFunc, FunctionTypeBase);
StringProtoMatchFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var regexp = args[0],
		s,
		rx,
		result,
		a,
		i,
		len;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal).value;

	// Steps 3 and 4
	if (regexp && regexp.className === 'RegExp') {
		rx = regexp;
	} else {
		if (!regexp || type(regexp) === 'Undefined') {
			rx = new RegExpType('', '');
		} else {
			rx = new RegExpType(toString(regexp).value, '');
		}
	}

	// Update the regexp object
	rx._refreshRegExpFromProperties();

	// Use the built-in match method to perform the match
	result = s.match(rx.value);

	// Update the regexp object
	rx._refreshPropertiesFromRegExp();

	// Check for no match
	if (result === null) {
		return new NullType();
	}

	// Create the results array
	a = new ArrayType();
	a.put('index', new NumberType(result.index), false, true);
	a.put('input', rx, false, true);
	for (i = 0, len = result.length; i < len; i++) {
		a.put(i, new StringType(result[i]), false, true);
	}
	a.put('length', new NumberType(result.length), false, true);
	return a;
});

/**
 * replace() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.11
 */
function StringProtoReplaceFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(StringProtoReplaceFunc, FunctionTypeBase);
StringProtoReplaceFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var searchValue = args[0],
		replaceValue = args[1],
		s,
		rx,
		result;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal).value;

	// Get the native searchValue
	if (searchValue.className !== 'RegExp') {
		searchValue = toString(searchValue);
	} else {
		searchValue._refreshRegExpFromProperties();
	}
	searchValue = searchValue.value;

	// Run the built-in replace method
	if (isCallable(replaceValue)) {
		result = new StringType(s.replace(searchValue, function () {
			var args = [
					new StringType(arguments[0]) // match
				],
				i, len;

			// Push the matches into the arguments
			for (i = 1, len = arguments.length - 2; i < len; i++) {
				args.push(new StringType(arguments[i]));
			}

			// Push the offset and the string into the arguments
			args.push(new NumberType(arguments[arguments.length - 2]));
			args.push(new StringType(arguments[arguments.length - 1]));

			// Call the callback method
			return toString(replaceValue.callFunction(new UndefinedType(), args)).value;
		}));
	} else {
		result = new StringType(s.replace(searchValue, toString(replaceValue).value));
	}

	// Update the regexp object
	if (searchValue.className === 'RegExp') {
		rx._refreshPropertiesFromRegExp();
	}

	return result;
});

/**
 * search() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.12
 */
function StringProtoSearchFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(StringProtoSearchFunc, FunctionTypeBase);
StringProtoSearchFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var regexp = args[0],
		string,
		rx,
		result;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	string = toString(thisVal).value;

	// Steps 3 and 4
	if (regexp && regexp.className === 'RegExp') {
		rx = regexp;
	} else {
		if (!regexp || type(regexp) === 'Undefined') {
			rx = new RegExpType('', '');
		} else {
			rx = new RegExpType(toString(regexp).value, '');
		}
	}

	// Update the regexp object
	rx._refreshRegExpFromProperties();

	// Use the built-in method to perform the match
	result = string.search(rx.value);

	// Update the regexp object
	rx._refreshPropertiesFromRegExp();

	return new NumberType(result);
});

/**
 * slice() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.13
 */
function StringProtoSliceFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(StringProtoSliceFunc, FunctionTypeBase);
StringProtoSliceFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var start = args[0],
		end = args[1],
		s;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal).value;

	// Step 4
	start = toInteger(start).value;

	// Step 5
	end = typeof end != 'undefined' ? toInteger(end).value : s.length;

	// Use the built-in method to perform the slice
	return new StringType(s.slice(start, end));
});

/**
 * split() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.14
 */
function StringProtoSplitFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(StringProtoSplitFunc, FunctionTypeBase);
StringProtoSplitFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var separator = args[0],
		limit = args[1],
		s,
		result,
		a,
		i,
		len;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}


	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal).value;

	// Convert the separator into a form the native method can use
	if (!separator || type(separator) === 'Undefined') {
		separator = undefined;
	} else if (separator.className === 'RegExp'){
		separator = separator.value;
	} else {
		separator = toString(separator).value;
	}

	// Convert the limit into a form the native method can use
	if (!limit || type(limit) === 'Undefined') {
		limit = undefined;
	} else {
		limit = toUint32(limit).value;
	}

	// Call the split method
	result = s.split(separator, limit);

	// Convert the results and return them
	a = new ArrayType();
	for (i = 0, len = result.length; i < len; i++) {
		a.put(i, new StringType(result[i]), false, true);
	}
	return a;
});

/**
 * substring() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.15
 */
function StringProtoSubstringFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(StringProtoSubstringFunc, FunctionTypeBase);
StringProtoSubstringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var start = args[0],
		end = args[1],
		s;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal).value;

	// Step 4
	start = toInteger(start).value;

	// Step 5
	end = typeof end != 'undefined' ? toInteger(end).value : s.length;

	// Use the built-in method to perform the substring
	return new StringType(s.substring(start, end));
});

/**
 * toLowerCase() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.16
 */
function StringProtoToLowerCaseFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(StringProtoToLowerCaseFunc, FunctionTypeBase);
StringProtoToLowerCaseFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var s;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal).value;

	// Use the built-in method to perform the toLowerCase
	return new StringType(s.toLowerCase());

});

/**
 * toLocaleLowerCase() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.17
 */
function StringProtoToLocaleLowerCaseFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(StringProtoToLocaleLowerCaseFunc, FunctionTypeBase);
StringProtoToLocaleLowerCaseFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var s;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal).value;

	// Use the built-in method to perform the toLowerCase
	return new StringType(s.toLocaleLowerCase());
});

/**
 * toUpperCase() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.18
 */
function StringProtoToUpperCaseFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(StringProtoToUpperCaseFunc, FunctionTypeBase);
StringProtoToUpperCaseFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var s;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal).value;

	// Use the built-in method to perform the toLowerCase
	return new StringType(s.toUpperCase());
});

/**
 * toLocaleUpperCase() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.19
 */
function StringProtoToLocaleUpperCaseFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(StringProtoToLocaleUpperCaseFunc, FunctionTypeBase);
StringProtoToLocaleUpperCaseFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var s;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal).value;

	// Use the built-in method to perform the toLowerCase
	return new StringType(s.toLocaleUpperCase());
});

/**
 * trim() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.4.20
 */
function StringProtoTrimFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(StringProtoTrimFunc, FunctionTypeBase);
StringProtoTrimFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var s;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	checkObjectCoercible(thisVal);

	// Step 2
	s = toString(thisVal).value;

	// Use the built-in method to perform the toLowerCase
	return new StringType(s.trim());
});

/**
 * @classdesc The prototype for Strings
 *
 * @constructor module:base/prototypes/string.StringPrototypeType
 * @see ECMA-262 Spec Chapter 15.5.4
 */
exports.StringPrototypeType = StringPrototypeType;
function StringPrototypeType(className) {
	ObjectType.call(this, className || 'String');
	this.primitiveValue = '';
	addNonEnumerableProperty(this, 'length', new NumberType(0), false, true);

	addNonEnumerableProperty(this, 'toString', new StringProtoToStringFunc(), false, true);
	addNonEnumerableProperty(this, 'valueOf', new StringProtoValueOfFunc(), false, true);
	addNonEnumerableProperty(this, 'charAt', new StringProtoCharAtFunc(), false, true);
	addNonEnumerableProperty(this, 'charCodeAt', new StringProtoCharCodeAtFunc(), false, true);
	addNonEnumerableProperty(this, 'concat', new StringProtoConcatFunc(), false, true);
	addNonEnumerableProperty(this, 'indexOf', new StringProtoIndexOfFunc(), false, true);
	addNonEnumerableProperty(this, 'lastIndexOf', new StringProtoLastIndexOfFunc(), false, true);
	addNonEnumerableProperty(this, 'localeCompare', new StringProtoLocaleCompareFunc(), false, true);
	addNonEnumerableProperty(this, 'match', new StringProtoMatchFunc(), false, true);
	addNonEnumerableProperty(this, 'replace', new StringProtoReplaceFunc(), false, true);
	addNonEnumerableProperty(this, 'search', new StringProtoSearchFunc(), false, true);
	addNonEnumerableProperty(this, 'slice', new StringProtoSliceFunc(), false, true);
	addNonEnumerableProperty(this, 'split', new StringProtoSplitFunc(), false, true);
	addNonEnumerableProperty(this, 'substring', new StringProtoSubstringFunc(), false, true);
	addNonEnumerableProperty(this, 'toLowerCase', new StringProtoToLowerCaseFunc(), false, true);
	addNonEnumerableProperty(this, 'toLocaleLowerCase', new StringProtoToLocaleLowerCaseFunc(), false, true);
	addNonEnumerableProperty(this, 'toUpperCase', new StringProtoToUpperCaseFunc(), false, true);
	addNonEnumerableProperty(this, 'toLocaleUpperCase', new StringProtoToLocaleUpperCaseFunc(), false, true);
	addNonEnumerableProperty(this, 'trim', new StringProtoTrimFunc(), false, true);
}
util.inherits(StringPrototypeType, ObjectType);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the object prototype
 *
 * @module base/prototypes/object
 */
/*global
util,
FunctionTypeBase,
StringType,
UnknownType,
areAnyUnknown,
type,
toObject,
isCallable,
handleRecoverableNativeException,
toString,
BooleanType,
isObject,
isType,
ObjectType,
addNonEnumerableProperty,
wrapNativeCall
*/

/*****************************************
 *
 * Object Prototype Class
 *
 *****************************************/

/**
 * toString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.4.2
 */
function ObjectProtoToStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(ObjectProtoToStringFunc, FunctionTypeBase);
ObjectProtoToStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var result = new StringType();

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (type(thisVal) === 'Undefined') {
		result.value = '[object Undefined]';
	} else if (type(thisVal) === 'Null') {
		result.value = '[object Null]';
	} else {
		result.value = '[object ' + toObject(thisVal).className + ']';
	}

	return result;
});

/**
 * toLocaleString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.4.3
 */
function ObjectProtoToLocaleStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(ObjectProtoToLocaleStringFunc, FunctionTypeBase);
ObjectProtoToLocaleStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o,
		toString;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	o = toObject(thisVal),
	toString = o.get('toString');
	if (type(toString) === 'Unknown') {
		return new UnknownType();
	} else if (!isCallable(toString)) {
		handleRecoverableNativeException('TypeError', 'toString is not callable');
		return new UnknownType();
	}
	return toString.callFunction(o);
});

/**
 * valueOf() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.4.4
 */
function ObjectProtoValueOfFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(ObjectProtoValueOfFunc, FunctionTypeBase);
ObjectProtoValueOfFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Convert to an object
	return toObject(thisVal);
});

/**
 * hasOwnProperty() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.4.5
 */
function ObjectProtoHasOwnPropertyFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ObjectProtoHasOwnPropertyFunc, FunctionTypeBase);
ObjectProtoHasOwnPropertyFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var p,
		o,
		desc;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	p = toString(args[0]);
	o = toObject(thisVal);
	desc = o.getOwnProperty(p.value);

	return new BooleanType(!!desc);
});

/**
 * isPrototypeOf() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.4.6
 */
function ObjectProtoIsPrototypeOfFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ObjectProtoIsPrototypeOfFunc, FunctionTypeBase);
ObjectProtoIsPrototypeOfFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var result = new BooleanType(),
		o,
		v = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (isObject(v)) {
		o = toObject(thisVal);
		while (true) {
			if (v === v.objectPrototype) {
				break;
			}
			v = v.objectPrototype;
			if (v && v.objectPrototype && type(v.objectPrototype) == 'Unknown') {
				return new UnknownType();
			}
			if (!v || isType(v, ['Undefined', 'Null'])) {
				break;
			}
			if (o === v) {
				result.value = true;
				break;
			}
		}
	}

	return result;
});

/**
 * propertyIsEnumerable() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.4.7
 */
function ObjectProtoPropertyIsEnumerableFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ObjectProtoPropertyIsEnumerableFunc, FunctionTypeBase);
ObjectProtoPropertyIsEnumerableFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var p,
		o,
		desc;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	p = toString(args[0]);
	o = toObject(thisVal);
	desc = o.getOwnProperty(p.value);

	return new BooleanType(typeof desc != 'undefined' && desc.enumerable);
});

/**
 * @classdesc The prototype for Objects, which is itself an object
 *
 * @constructor module:base/prototypes/object.ObjectPrototypeType
 * @see ECMA-262 Spec Chapter 15.2.4
 */
exports.ObjectPrototypeType = ObjectPrototypeType;
function ObjectPrototypeType(className) {
	ObjectType.call(this, className || 'Object', undefined, true);

	addNonEnumerableProperty(this, 'toString', new ObjectProtoToStringFunc(), false, true);
	addNonEnumerableProperty(this, 'toLocaleString', new ObjectProtoToLocaleStringFunc(), false, true);
	addNonEnumerableProperty(this, 'valueOf', new ObjectProtoValueOfFunc(), false, true);
	addNonEnumerableProperty(this, 'hasOwnProperty', new ObjectProtoHasOwnPropertyFunc(), false, true);
	addNonEnumerableProperty(this, 'isPrototypeOf', new ObjectProtoIsPrototypeOfFunc(), false, true);
	addNonEnumerableProperty(this, 'propertyIsEnumerable', new ObjectProtoPropertyIsEnumerableFunc(), false, true);
}
util.inherits(ObjectPrototypeType, ObjectType);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the array prototype
 *
 * @module base/prototypes/array
 */
/*global
util,
FunctionTypeBase,
areAnyUnknown,
UnknownType,
toObject,
type,
isCallable,
ObjectProtoToStringFunc,
toUint32,
StringType,
isType,
handleRecoverableNativeException,
ArrayType,
NumberType,
toString,
UndefinedType,
toInteger,
strictEquals,
BooleanType,
toBoolean,
ObjectType,
ObjectProtoValueOfFunc,
ObjectProtoHasOwnPropertyFunc,
ObjectProtoIsPrototypeOfFunc,
ObjectProtoPropertyIsEnumerableFunc,
addNonEnumerableProperty,
wrapNativeCall,
convertToUnknown
*/

/*****************************************
 *
 * Array Prototype Class
 *
 *****************************************/

/**
 * toString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.2
 */
function ArrayProtoToStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(ArrayProtoToStringFunc, FunctionTypeBase);
ArrayProtoToStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations,
	var array,
		func;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1 and 2
	array = toObject(thisVal);
	func = array.get('join');

	// Step 3
	if (type(func) === 'Unknown') {
		return new UnknownType();
	} else if (!isCallable(func)) {
		func = new ObjectProtoToStringFunc();
	}

	// Step 4
	return func.callFunction(array, []);
});

/**
 * toLocaleString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.3
 */
function ArrayProtoToLocaleStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(ArrayProtoToLocaleStringFunc, FunctionTypeBase);
ArrayProtoToLocaleStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var array,
		len,
		separator,
		firstElement,
		r,
		func,
		elementObj,
		k,
		s,
		nextElement;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-4
	array = toObject(thisVal);
	len = toUint32(array.get('length')).value;
	separator = ',';
	k = 1;

	// Step 5
	if (len === 0) {
		return new StringType();
	}

	// Step 6
	firstElement = array.get(0);

	// Steps 7 and 8
	if (isType(firstElement, ['Undefined', 'Null'])) {
		r = '';
	} else {
		elementObj = toObject(firstElement);
		func = elementObj.get('toLocaleString');
		if (type(elementObj) === 'Unknown' || type(func) === 'Unknown') {
			return new UnknownType();
		}
		if (!isCallable(func)) {
			handleRecoverableNativeException('TypeError', 'toLocaleString is not callable');
			return new UnknownType();
		}
		r = func.callFunction(elementObj, []).value;
	}

	// Step 10
	while (k < len) {
		s = r + separator;
		nextElement = array.get(k);
		if (isType(nextElement, ['Undefined', 'Null'])) {
			r = '';
		} else {
			elementObj = toObject(nextElement);
			func = elementObj.get('toLocaleString');
			if (type(elementObj) === 'Unknown' || type(func) === 'Unknown') {
				return new UnknownType();
			}
			if (!isCallable(func)) {
				handleRecoverableNativeException('TypeError', 'toLocaleString is not callable');
				return new UnknownType();
			}
			r = func.callFunction(elementObj, []).value;
		}
		r = s + r;
		k++;
	}

	// Step 11
	return new StringType(r);
});

/**
 * concat() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.4
 */
function ArrayProtoConcatFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ArrayProtoConcatFunc, FunctionTypeBase);
ArrayProtoConcatFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o,
		a,
		n,
		items,
		e,
		k,
		len;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-4
	o = toObject(thisVal);
	a = new ArrayType();
	n = 0;
	items = [o].concat(args);

	// Step 5
	while (items.length) {

		// Step 5.a
		e = items.shift();

		if (e.className === 'Array') { // Step 5.b
			k = 0;
			len = e.get('length').value;
			while (k < len) {
				if (e.hasProperty(k)) {
					a.defineOwnProperty(n, {
						value: e.get(k),
						writable: true,
						enumerable: true,
						configurable: true
					}, false, true);
				}
				n++;
				k++;
			}
		} else { // Step 5.c
			a.defineOwnProperty(n, {
				value: e,
				writable: true,
				enumerable: true,
				configurable: true
			}, false, true);
			n++;
		}
	}

	// Why is length not set in the spec? Seems to be an omissions since other methods (like pop) do it.
	a._addProperty('length', {
		value: new NumberType(n),
		writable: true,
		enumerable: false,
		configurable: false
	});

	// Step 6
	return a;
});

/**
 * join() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.5
 */
function ArrayProtoJoinFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ArrayProtoJoinFunc, FunctionTypeBase);
ArrayProtoJoinFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var separator,
		o,
		len,
		sep,
		r,
		element0,
		k,
		s,
		element,
		next;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-3
	separator = args[0];
	o = toObject(thisVal);
	len = toUint32(o.get('length')).value;
	k = 1;

	// Steps 4 and 5
	if (!separator || type(separator) === 'Undefined') {
		sep = ',';
	} else {
		sep = toString(separator).value;
	}

	// Step 6
	if (len === 0) {
		return new StringType();
	}

	// Step 7
	element0 = o.get(0);

	// Step 8
	if (isType(element0, ['Undefined', 'Null'])) {
		r = '';
	} else {
		r = toString(element0).value;
	}

	// Step 10
	while (k < len) {
		s = r + sep;
		element = o.get(k);
		if (isType(element, ['Undefined', 'Null'])) {
			next = '';
		} else {
			next = toString(element).value;
		}
		r = s + next;
		k++;
	}

	// Step 11
	return new StringType(r);
});

/**
 * pop() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.6
 */
function ArrayProtoPopFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(ArrayProtoPopFunc, FunctionTypeBase);
ArrayProtoPopFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args, options) {

	// Variable declarations
	var o,
		len,
		indx,
		element;

	if (options && options.isAmbiguousContext) {
		convertToUnknown(thisVal);
		return new UnknownType();
	}

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-3
	o = toObject(thisVal);
	len = toUint32(o.get('length')).value;

	// Steps 4 and 5
	if (len === 0) {
		o._addProperty('length', {
			value: new NumberType(0),
			writable: true,
			enumerable: false,
			configurable: false
		});
		return new UndefinedType();
	} else {
		indx = len - 1;
		element = o.get(indx);
		o['delete'](indx, true);
		o._addProperty('length', {
			value: new NumberType(indx),
			writable: true,
			enumerable: false,
			configurable: false
		});
		return element;
	}
});

/**
 * push() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.7
 */
function ArrayProtoPushFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ArrayProtoPushFunc, FunctionTypeBase);
ArrayProtoPushFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args, options) {

	// Steps 1-4
	var o,
		n,
		items,
		lengthNumber;

	if (options && options.isAmbiguousContext) {
		convertToUnknown(thisVal);
		return new UnknownType();
	}

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-4
	o = toObject(thisVal);
	n = toUint32(o.get('length')).value;
	items = args;
	lengthNumber = new NumberType();

	// Step 5
	while (items.length) {
		o.put(n++, items.shift(), true, true);
	}

	// Step 6
	lengthNumber.value = n;
	o._addProperty('length', {
		value: lengthNumber,
		writable: true,
		enumerable: false,
		configurable: false
	});

	// Step 7
	return lengthNumber;
});

/**
 * reverse() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.8
 */
function ArrayProtoReverseFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(ArrayProtoReverseFunc, FunctionTypeBase);
ArrayProtoReverseFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args, options) {

	// Variable declarations
	var o,
		len,
		upper,
		middle,
		lower,
		upperValue,
		lowerValue,
		lowerExists,
		upperExists;

	if (options && options.isAmbiguousContext) {
		convertToUnknown(thisVal);
		return new UnknownType();
	}

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-5
	o = toObject(thisVal);
	len = toUint32(o.get('length')).value;
	middle = Math.floor(len / 2);
	lower = 0;

	// Step 6
	while (lower !== middle) {
		upper = len - lower - 1;

		lowerValue = o.get(lower);
		upperValue = o.get(upper);

		lowerExists = o.hasProperty(lower);
		upperExists = o.hasProperty(upper);

		if (lowerExists && upperExists) {
			o.put(lower, upperValue, true, true);
			o.put(upper, lowerValue, true, true);
		} else if (upperExists) {
			o.put(lower, upperValue, true, true);
			o['delete'](upper, true);
		} else if (lowerExists) {
			o['delete'](o, lower);
			o.put(upper, lowerValue, true, true);
		}

		lower++;
	}

	// Step 7
	return o;
});

/**
 * shift() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.9
 */
function ArrayProtoShiftFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(ArrayProtoShiftFunc, FunctionTypeBase);
ArrayProtoShiftFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args, options) {

	// Variable declarations
	var o,
		len,
		first,
		k,
		from,
		to;

	if (options && options.isAmbiguousContext) {
		convertToUnknown(thisVal);
		return new UnknownType();
	}

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-3
	o = toObject(thisVal);
	len = toUint32(o.get('length')).value;
	k = 1;

	// Step 4
	if (len === 0) {
		o._addProperty('length', {
			value: new NumberType(0),
			writable: true,
			enumerable: false,
			configurable: false
		});
		return new UndefinedType();
	}

	// Step 5
	first = o.get(0);

	// Step 7
	while (k < len) {
		from = k;
		to = k - 1;

		if (o.hasProperty(from)) {
			o.put(to, o.get(from), true, true);
		} else {
			o['delete'](to, true);
		}
		k++;
	}

	// Step 8
	o['delete'](len - 1, true);

	// Step 9
	o._addProperty('length', {
		value: new NumberType(len - 1),
		writable: true,
		enumerable: false,
		configurable: false
	});

	// Step 10
	return first;
});

/**
 * slice() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.10
 */
function ArrayProtoSliceFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(ArrayProtoSliceFunc, FunctionTypeBase);
ArrayProtoSliceFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var start,
		end,
		o,
		a,
		len,
		relativeStart,
		k,
		relativeEnd,
		finalVal,
		n;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-9
	start = args[0] || new NumberType(0);
	end = args[1];
	o = toObject(thisVal);
	a = new ArrayType();
	len = toUint32(o.get('length')).value;
	relativeStart = toInteger(start).value;
	k = relativeStart < 0 ? Math.max(len + relativeStart, 0) : Math.min(relativeStart, len);
	relativeEnd = !end || type(end) === 'Undefined' ? len : toInteger(end).value;
	finalVal = relativeEnd < 0 ? Math.max(len + relativeEnd, 0) : Math.min(relativeEnd, len);
	n = 0;

	// Step 10
	while (k < finalVal) {
		if (o.hasProperty(k)) {
			a.defineOwnProperty(n, {
				value: o.get(k),
				writable: true,
				enumerable: true,
				configurable: true
			}, false, true);
		}
		k++;
		n++;
	}

	// Step 11
	return a;
});

/**
 * sort() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.11
 */
function ArrayProtoSortFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(ArrayProtoSortFunc, FunctionTypeBase);
ArrayProtoSortFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args, options) {

	// Variable declarations
	var compareFn,
		o,
		len,
		changes;

	if (options && options.isAmbiguousContext) {
		convertToUnknown(thisVal);
		return new UnknownType();
	}

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	compareFn = args[0];
	o = toObject(thisVal);
	len = toUint32(o.get('length')).value;
	changes = true;

	function swapValues(j, k) {
		var jValue,
			kValue;

		// Pull the values out of the array, if they exist
		if (o.hasProperty(j)) {
			jValue = o.get(j);
			o['delete'](j, true);
		}
		if (o.hasProperty(k)) {
			kValue = o.get(k);
			o['delete'](k, true);
		}

		// Put the values back into the array in their swapped positions
		if (jValue) {
			o.put(k, jValue, true, true);
		}
		if (kValue) {
			o.put(j, kValue, true, true);
		}
	}

	// SortCompare algorithm
	function sortCompare(j, k) {

		// Steps 3 and 4
		var hasj = o.hasProperty(j),
			hask = o.hasProperty(k),
			x,
			y,
			xType,
			yType,
			xVal,
			yVal;

		// Steps 5-7
		if (!hasj && !hask) {
			return 0;
		}
		if (!hasj) {
			return 1;
		}
		if (!hask) {
			return -1;
		}

		// Steps 8 and 9
		x = o.get(j);
		y = o.get(k);
		xType = type(x);
		yType = type(y);

		// Steps 10-12
		if (xType === 'Unknown' || yType === 'Unknown') {
			return NaN;
		}
		if (xType === 'Undefined' && yType === 'Undefined') {
			return 0;
		}
		if (xType === 'Undefined') {
			return 1;
		}
		if (yType === 'Undefined') {
			return -1;
		}

		// Step 13
		if (compareFn && type(compareFn) !== 'Undefined') {
			if (type(compareFn) === 'Unknown') {
				throw 'Unknown';
			}
			if (!isCallable(compareFn)) {
				handleRecoverableNativeException('TypeError', 'Compare funciton is not callable');
				return new UnknownType();
			}
			return compareFn.callFunction(new UndefinedType(), [x, y]).value;
		}

		// Note: the spec says to always convert to a string and compare, but string comparisons don't work the same as
		// number comparisons in JavaScript, so we have to handle numbers specially (i.e. 1 < 10 !== '1' < '10')
		if (xType !== 'Number' || yType !== 'Number') {

			// Steps 14 and 15
			x = toString(x);
			y = toString(y);
		}
		xVal = x.value;
		yVal = y.value;

		// Steps 16-18
		if (xVal < yVal) {
			return -1;
		}
		if (xVal > yVal) {
			return 1;
		}
		return 0;
	}

	// In-place quicksort algorithm
	function sort(leftIndex, rightIndex) {
		var storeIndex = leftIndex,
			pivotIndex = Math.floor((rightIndex - leftIndex) / 2) + leftIndex,
			i,
			sortResult;

		if (leftIndex < rightIndex) {

			// Swap the pivot and right values
			swapValues(pivotIndex, rightIndex);

			// Sort the array into the two pivot arrays
			for (i = leftIndex; i < rightIndex; i++) {

				// Compare i and the store index, and swap if necessary
				sortResult = sortCompare(i, rightIndex);
				if (isNaN(sortResult)) {
					throw 'Unknown';
				} else if (sortResult < 0) {
					swapValues(i, storeIndex);
					storeIndex++;
				}
			}

			// Swap the pivot back into place and return its index
			swapValues(storeIndex, rightIndex);

			// Sort the left and right sides of the pivot
			sort(leftIndex, storeIndex - 1);
			sort(storeIndex + 1, rightIndex);
		}
	}

	// Sort the array
	try {
		sort(0, len - 1);
	} catch(e) {
		var integerRegex = /^[0-9]*$/;
		if (e === 'Unknown') {
			this._getPropertyNames().forEach(function (propName) {
				if (integerRegex.test(propName)) {
					this._addProperty(propName, {
						value: new UnknownType(),
						writable: false,
						configurable: false,
						enumerable: true
					});
				}
			}.bind(this));
		} else {
			throw e;
		}
	}

	// Return the sorted object
	return o;
});

/**
 * splice() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.12
 */
function ArrayProtoSpliceFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(ArrayProtoSpliceFunc, FunctionTypeBase);
ArrayProtoSpliceFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args, options) {

	// Variable declarations
	var start,
		deleteCount,
		o,
		a,
		len,
		relativeStart,
		actualStart,
		actualDeleteCount,
		k,
		from,
		to,
		items,
		itemCount;

	if (options && options.isAmbiguousContext) {
		convertToUnknown(thisVal);
		return new UnknownType();
	}

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-8
	start = args[0];
	deleteCount = args[1];
	o = toObject(thisVal);
	a = new ArrayType();
	len = toUint32(o.get('length')).value;
	relativeStart = toUint32(start).value;
	actualStart = relativeStart < 0 ? Math.max(len + relativeStart, 0) : Math.min(relativeStart, len);
	actualDeleteCount = Math.min(Math.max(toInteger(deleteCount).value, 0), len - actualStart);
	k = 0;

	// Step 9
	while (k < actualDeleteCount) {
		from = actualStart + k;
		if (o.hasProperty(from)) {
			a.defineOwnProperty(k, {
				value: o.get(from),
				writable: true,
				enumerable: true,
				configurable: true
			}, false, true);
		}
		k++;
	}

	// Steps 10 and 11
	items = args.slice(2);
	itemCount = items.length;

	// Steps 12 and 13
	if (itemCount < actualDeleteCount) {
		k = actualStart;
		while (k < len - actualDeleteCount) {
			from = k + actualDeleteCount;
			to = k + itemCount;

			if (o.hasProperty(from)) {
				o.put(to, o.get(from), true, true);
			} else {
				o['delete'](to, true, true);
			}
			k++;
		}
		k = len;
		while (k > len - actualDeleteCount + itemCount) {
			o['delete'](k - 1, true);
			k--;
		}
	} else if (itemCount > actualDeleteCount) {
		k = len - actualDeleteCount;
		while (k > actualStart) {
			from = k + actualDeleteCount - 1;
			to = k + itemCount - 1;

			if (o.hasProperty(from)) {
				o.put(to, o.get(from), true, true);
			} else {
				o['delete'](to, true);
			}

			k--;
		}
	}

	// Step 14
	k = actualStart;

	// Step 15
	while (items.length) {
		o.put(k, items.shift(), true, true);
		k++;
	}

	// Step 16
	o._addProperty('length', {
		value: new NumberType(len - actualDeleteCount + itemCount),
		writable: true,
		enumerable: false,
		configurable: false
	});

	// Step 17
	return a;
});

/**
 * unshift() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.13
 */
function ArrayProtoUnshiftFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ArrayProtoUnshiftFunc, FunctionTypeBase);
ArrayProtoUnshiftFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args, options) {

	// Variable declarations
	var o,
		len,
		argCount,
		k = len,
		from,
		to,
		j,
		items;

	if (options && options.isAmbiguousContext) {
		convertToUnknown(thisVal);
		return new UnknownType();
	}

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-5
	o = toObject(thisVal);
	len = toUint32(o.get('length')).value;
	argCount = args.length;
	k = len;

	// Step 6
	while (k > 0) {
		from = k - 1;
		to = k + argCount - 1;

		if (o.hasProperty(from)) {
			o.put(to, o.get(from), true, true);
		} else {
			o['delete'](to, true, true);
		}

		k--;
	}

	// Step 7 and 8
	j = 0;
	items = args;

	// Step 9
	while (items.length) {
		o.put(j++, items.shift(), true, true);
	}

	// Step 10
	o._addProperty('length', {
		value: new NumberType(len + argCount),
		writable: true,
		enumerable: false,
		configurable: false
	});

	// Step 11
	return new NumberType(len + argCount);
});

/**
 * indexOf() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.14
 */
function ArrayProtoIndexOfFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ArrayProtoIndexOfFunc, FunctionTypeBase);
ArrayProtoIndexOfFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	var searchElement,
		fromIndex,
		o,
		len,
		n = 0,
		k,
		elementK;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-3
	searchElement = args[0] || new UndefinedType();
	fromIndex = args[1] || new NumberType(0);
	o = toObject(thisVal);
	len = toUint32(o.get('length')).value;

	// Step 4
	if (len === 0) {
		return new NumberType(-1);
	}

	// Step 5
	if (fromIndex && type(fromIndex) !== 'Undefined') {
		n = toInteger(fromIndex).value;
	}

	// Step 6
	if (n >= len) {
		return new NumberType(-1);
	}

	// Steps 7 and 8
	k = n >= 0 ? n : Math.max(len - Math.abs(n), 0);

	// Step 9
	while (k < len) {
		if (o.hasProperty(k)) {
			elementK = o.get(k);
			if (type(elementK) === 'Unknown') {
				return new UnknownType();
			}
			if (strictEquals(searchElement, elementK)) {
				return new NumberType(k);
			}
		}
		k++;
	}

	// Step 10
	return new NumberType(-1);
});

/**
 * indexOf() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.15
 */
function ArrayProtoLastIndexOfFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(ArrayProtoLastIndexOfFunc, FunctionTypeBase);
ArrayProtoLastIndexOfFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var searchElement,
		fromIndex,
		o,
		len,
		n,
		k,
		elementK;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-3
	o = toObject(thisVal);
	len = toUint32(o.get('length')).value;
	searchElement = args[0] || new UndefinedType();
	fromIndex = args[1] || new NumberType(len - 1);
	n = len - 1;

	// Step 4
	if (len === 0) {
		return new NumberType(-1);
	}

	// Step 5
	if (fromIndex && type(fromIndex) !== 'Undefined') {
		n = toInteger(fromIndex).value;
	}

	// Steps 6 and 7
	k = n >= 0 ? Math.min(n, len - 1) : len - Math.abs(n);

	// Step 8
	while (k >= 0) {
		if (o.hasProperty(k)) {
			elementK = o.get(k);
			if (type(elementK) === 'Unknown') {
				return new UnknownType();
			}
			if (strictEquals(searchElement, elementK)) {
				return new NumberType (k);
			}
		}
		k--;
	}

	// Step 9
	return new NumberType(-1);
});

/**
 * every() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.16
 */
function ArrayProtoEveryFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ArrayProtoEveryFunc, FunctionTypeBase);
ArrayProtoEveryFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var callbackFn,
		thisArg,
		o,
		len,
		t,
		k;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-3
	callbackFn = args[0];
	thisArg = args[1];
	o = toObject(thisVal);
	len = toUint32(o.get('length')).value;
	k = 0;

	// Step 4
	if (!isCallable(callbackFn)) {
		handleRecoverableNativeException('TypeError', 'Callback function is not callable');
		return new UnknownType();
	}

	// Step 5
	t = callbackFn && type(callbackFn) === 'Undefined' ? callbackFn : new UndefinedType();

	// Step 7
	while (k < len) {
		if (o.hasProperty(k) && !toBoolean(callbackFn.callFunction(t, [o.get(k), new NumberType(k), o])).value) {
			return new BooleanType(false);
		}
		k++;
	}

	// Step 8
	return new BooleanType(true);
});

/**
 * some() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.17
 */
function ArrayProtoSomeFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ArrayProtoSomeFunc, FunctionTypeBase);
ArrayProtoSomeFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var callbackFn,
		thisArg,
		o,
		len,
		t,
		k;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-3
	callbackFn = args[0];
	thisArg = args[1];
	o = toObject(thisVal);
	len = toUint32(o.get('length')).value;
	k = 0;

	if (callbackFn && type(callbackFn) === 'Unknown' || thisArg && type(thisArg) === 'Unknown') {
		return new UnknownType();
	}

	// Step 4
	if (!isCallable(callbackFn)) {
		handleRecoverableNativeException('TypeError', 'Callback function is not callable');
		return new UnknownType();
	}

	// Step 5
	t = callbackFn && type(callbackFn) === 'Undefined' ? callbackFn : new UndefinedType();

	// Step 7
	while (k < len) {
		if (o.hasProperty(k) && toBoolean(callbackFn.callFunction(t, [o.get(k), new NumberType(k), o])).value) {
			return new BooleanType(true);
		}
		k++;
	}

	// Step 8
	return new BooleanType(false);
});

/**
 * forEach() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.18
 */
function ArrayProtoForEachFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ArrayProtoForEachFunc, FunctionTypeBase);
ArrayProtoForEachFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var callbackFn,
		thisArg,
		o,
		len,
		t,
		k;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-3
	callbackFn = args[0];
	thisArg = args[1];
	o = toObject(thisVal);
	len = toUint32(o.get('length')).value;
	k = 0;

	// Step 4
	if (!isCallable(callbackFn)) {
		handleRecoverableNativeException('TypeError', 'Callback function is not callable');
		return new UnknownType();
	}

	// Step 5
	t = callbackFn && type(callbackFn) === 'Undefined' ? callbackFn : new UndefinedType();

	// Step 7
	while  (k < len) {
		if (o.hasProperty(k)) {
			callbackFn.callFunction(t, [o.get(k), new NumberType(k), o]);
		}
		k++;
	}

	// Step 8
	return new UndefinedType();
});

/**
 * map() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.19
 */
function ArrayProtoMapFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ArrayProtoMapFunc, FunctionTypeBase);
ArrayProtoMapFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var callbackFn,
		thisArg,
		o,
		len,
		t,
		a,
		k;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-3
	callbackFn = args[0];
	thisArg = args[1];
	o = toObject(thisVal);
	len = toUint32(o.get('length')).value;
	k = 0;

	// Step 4
	if (!isCallable(callbackFn)) {
		handleRecoverableNativeException('TypeError', 'Callback function is not callable');
		return new UnknownType();
	}

	// Step 5
	t = callbackFn && type(callbackFn) === 'Undefined' ? callbackFn : new UndefinedType();

	// Step 6
	a = new ArrayType();
	a._addProperty('length', {
		value: new NumberType(len),
		writable: true,
		enumerable: false,
		configurable: false
	});

	// Step 8
	while (k < len) {
		if (o.hasProperty(k)) {
			a.defineOwnProperty(k, {
				value: callbackFn.callFunction(t, [o.get(k), new NumberType(k), o]),
				writable: true,
				enumerable: true,
				configurable: true
			}, false, true);
		}
		k++;
	}

	// Step 9
	return a;
});

/**
 * filter() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.20
 */
function ArrayProtoFilterFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ArrayProtoFilterFunc, FunctionTypeBase);
ArrayProtoFilterFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var callbackFn,
		thisArg,
		o,
		len,
		t,
		a,
		k,
		to,
		kValue;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-3
	callbackFn = args[0];
	thisArg = args[1];
	o = toObject(thisVal);
	len = toUint32(o.get('length')).value;
	k = 0;
	to = 0;

	// Step 4
	if (!isCallable(callbackFn)) {
		handleRecoverableNativeException('TypeError', 'Callback function is not callable');
		return new UnknownType();
	}

	// Step 5
	t = callbackFn && type(callbackFn) === 'Undefined' ? callbackFn : new UndefinedType();

	// Step 6
	a = new ArrayType();
	a._addProperty('length', {
		value: new NumberType(len),
		writable: true,
		enumerable: false,
		configurable: false
	});

	// Step 9
	while (k < len) {
		if (o.hasProperty(k)) {
			kValue = o.get(k);
			if (toBoolean(callbackFn.callFunction(t, [kValue, new NumberType(k), o])).value) {
				a.defineOwnProperty(to, {
					value: kValue,
					writable: true,
					enumerable: true,
					configurable: true
				}, false, true);
				to++;
			}
		}
		k++;
	}

	// Step 10
	return a;
});

/**
 * reduce() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.21
 */
function ArrayProtoReduceFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ArrayProtoReduceFunc, FunctionTypeBase);
ArrayProtoReduceFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var callbackFn,
		initialValue,
		o,
		len,
		k,
		to,
		accumulator,
		kPresent,
		undef;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-3
	callbackFn = args[0];
	initialValue = args[1];
	o = toObject(thisVal);
	len = toUint32(o.get('length')).value;
	k = 0;
	to = 0;
	undef = new UndefinedType();

	// Step 4
	if (!isCallable(callbackFn)) {
		handleRecoverableNativeException('TypeError', 'Callback function is not callable');
		return new UnknownType();
	}

	// Step 5
	if (len === 0 && !initialValue) {
		handleRecoverableNativeException('TypeError', 'Missing initial value');
		return new UnknownType();
	}

	// Steps 7 and 8
	if (initialValue) {
		accumulator = initialValue;
	} else {
		kPresent = false;
		while (!kPresent && k < len) {
			kPresent = o.hasProperty(k);
			if (kPresent) {
				accumulator = o.get(k);
			}
			k++;
		}
		if (!kPresent) {
			handleRecoverableNativeException('TypeError', 'Missing property ' + k);
			return new UnknownType();
		}
	}

	// Step 9
	while (k < len) {
		if (o.hasProperty(k)) {
			accumulator = callbackFn.callFunction(undef, [accumulator, o.get(k), new NumberType(k), o]);
		}
		k++;
	}

	// Step 10
	return accumulator;
});

/**
 * reduceRight() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.4.22
 */
function ArrayReduceRightFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ArrayReduceRightFunc, FunctionTypeBase);
ArrayReduceRightFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var callbackFn,
		initialValue,
		o,
		len,
		k,
		to,
		accumulator,
		kPresent,
		undef;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1-3
	callbackFn = args[0];
	initialValue = args[1];
	o = toObject(thisVal);
	len = toUint32(o.get('length')).value;
	k = len - 1;
	to = 0;
	undef = new UndefinedType();

	// Step 4
	if (!isCallable(callbackFn)) {
		handleRecoverableNativeException('TypeError', 'Callback function is not callable');
		return new UnknownType();
	}

	// Step 5
	if (len === 0 && !initialValue) {
		handleRecoverableNativeException('TypeError', 'Missing initial value');
		return new UnknownType();
	}

	// Steps 7 and 8
	if (initialValue) {
		accumulator = initialValue;
	} else {
		kPresent = false;
		while (!kPresent && k >= 0) {
			kPresent = o.hasProperty(k);
			if (kPresent) {
				accumulator = o.get(k);
			}
			k--;
		}
		if (!kPresent) {
			handleRecoverableNativeException('TypeError', 'Missing property ' + k);
			return new UnknownType();
		}
	}

	// Step 9
	while (k >= 0) {
		if (o.hasProperty(k)) {
			accumulator = callbackFn.callFunction(undef, [accumulator, o.get(k), new NumberType(k), o]);
		}
		k--;
	}

	// Step 10
	return accumulator;
});

/**
 * @classdesc The prototype for Arrays
 *
 * @constructor module:base/prototypes/array.ArrayPrototypeType
 * @see ECMA-262 Spec Chapter 15.4.4
 */
exports.ArrayPrototypeType = ArrayPrototypeType;
function ArrayPrototypeType(className) {
	ObjectType.call(this, className);

	// Object prototype methods
	addNonEnumerableProperty(this, 'valueOf', new ObjectProtoValueOfFunc(), false, true);
	addNonEnumerableProperty(this, 'hasOwnProperty', new ObjectProtoHasOwnPropertyFunc(), false, true);
	addNonEnumerableProperty(this, 'isPrototypeOf', new ObjectProtoIsPrototypeOfFunc(), false, true);
	addNonEnumerableProperty(this, 'propertyIsEnumerable', new ObjectProtoPropertyIsEnumerableFunc(), false, true);

	// Array prototype methods
	addNonEnumerableProperty(this, 'toString', new ArrayProtoToStringFunc(), false, true);
	addNonEnumerableProperty(this, 'toLocaleString', new ArrayProtoToLocaleStringFunc(), false, true);
	addNonEnumerableProperty(this, 'concat', new ArrayProtoConcatFunc(), false, true);
	addNonEnumerableProperty(this, 'join', new ArrayProtoJoinFunc(), false, true);
	addNonEnumerableProperty(this, 'pop', new ArrayProtoPopFunc(), false, true);
	addNonEnumerableProperty(this, 'push', new ArrayProtoPushFunc(), false, true);
	addNonEnumerableProperty(this, 'reverse', new ArrayProtoReverseFunc(), false, true);
	addNonEnumerableProperty(this, 'shift', new ArrayProtoShiftFunc(), false, true);
	addNonEnumerableProperty(this, 'slice', new ArrayProtoSliceFunc(), false, true);
	addNonEnumerableProperty(this, 'sort', new ArrayProtoSortFunc(), false, true);
	addNonEnumerableProperty(this, 'splice', new ArrayProtoSpliceFunc(), false, true);
	addNonEnumerableProperty(this, 'unshift', new ArrayProtoUnshiftFunc(), false, true);
	addNonEnumerableProperty(this, 'indexOf', new ArrayProtoIndexOfFunc(), false, true);
	addNonEnumerableProperty(this, 'lastIndexOf', new ArrayProtoLastIndexOfFunc(), false, true);
	addNonEnumerableProperty(this, 'every', new ArrayProtoEveryFunc(), false, true);
	addNonEnumerableProperty(this, 'some', new ArrayProtoSomeFunc(), false, true);
	addNonEnumerableProperty(this, 'forEach', new ArrayProtoForEachFunc(), false, true);
	addNonEnumerableProperty(this, 'map', new ArrayProtoMapFunc(), false, true);
	addNonEnumerableProperty(this, 'filter', new ArrayProtoFilterFunc(), false, true);
	addNonEnumerableProperty(this, 'reduce', new ArrayProtoReduceFunc(), false, true);
	addNonEnumerableProperty(this, 'reduceRight', new ArrayReduceRightFunc(), false, true);
}
util.inherits(ArrayPrototypeType, ObjectType);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the regexp prototype
 *
 * @module base/prototypes/regexp
 */
/*global
util,
FunctionTypeBase,
areAnyUnknown,
UnknownType,
toString,
ArrayType,
NullType,
NumberType,
StringType,
BooleanType,
toBoolean,
ObjectType,
addNonEnumerableProperty,
addReadOnlyProperty,
handleRecoverableNativeException,
type,
wrapNativeCall
*/

/*****************************************
 *
 * RegExp Prototype Class
 *
 *****************************************/

/**
 * exec() prototype method. Note: here we wrap node's native exec method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.10.6.2 and https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Global_Objects/RegExp/exec
 */
function RegExpProtoExecFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(RegExpProtoExecFunc, FunctionTypeBase);
RegExpProtoExecFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var r,
		rValue,
		s,
		result,
		a,
		i,
		len;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Make sure this is a regexp object
	if (type(thisVal) !== 'Object' || thisVal.className !== 'RegExp') {
		handleRecoverableNativeException('TypeError', 'exec must be called on a RegExp object');
		return new UnknownType();
	}

	// Initialize values
	r = thisVal;
	rValue = r.value;
	s = toString(args[0]);
	a = new ArrayType();

	// Update lastIndex since it's writeable
	rValue.lastIndex = r.get('lastIndex').value;

	// Update the regexp object
	r._refreshRegExpFromProperties();

	// Perform the exec
	result = r.value.exec(s.value);

	// Update the regexp object
	r._refreshPropertiesFromRegExp();

	// Check for no match
	if (result === null) {
		return new NullType();
	}

	// Create the results array
	a.put('index', new NumberType(result.index), false, true);
	a.put('input', s, false, true);
	for (i = 0, len = result.length; i < len; i++) {
		a.put(i, new StringType(result[i]), false, true);
	}
	a.put('length', new NumberType(result.length), false, true);
	return a;
});

/**
 * test() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.10.6.3
 */
function RegExpProtoTestFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(RegExpProtoTestFunc, FunctionTypeBase);
RegExpProtoTestFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	return toBoolean(RegExpProtoExecFunc.prototype.callFunction(thisVal, args));
});

/**
 * toString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.10.6.4
 */
function RegExpProtoToStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(RegExpProtoToStringFunc, FunctionTypeBase);
RegExpProtoToStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	return new StringType(thisVal.value.toString());
});

/**
 * @classdesc The prototype for RegExps
 *
 * @constructor module:base/prototypes/regexp.RegExpPrototypeType
 * @see ECMA-262 Spec Chapter 15.10.6
 */
exports.RegExpPrototypeType = RegExpPrototypeType;
function RegExpPrototypeType(className) {
	ObjectType.call(this, className);

	addNonEnumerableProperty(this, 'exec', new RegExpProtoExecFunc());
	addNonEnumerableProperty(this, 'test', new RegExpProtoTestFunc());
	addNonEnumerableProperty(this, 'toString', new RegExpProtoToStringFunc());

	addReadOnlyProperty(this, 'source', new StringType('(?:)'));
	addReadOnlyProperty(this, 'global', new BooleanType(false));
	addReadOnlyProperty(this, 'ignoreCase', new BooleanType(false));
	addReadOnlyProperty(this, 'multiline', new BooleanType(false));
	addReadOnlyProperty(this, 'lastIndex', new NumberType(0));
}
util.inherits(RegExpPrototypeType, ObjectType);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the function prototype
 *
 * @module base/prototypes/function
 */
/*global
util,
FunctionTypeBase,
areAnyUnknown,
UnknownType,
handleRecoverableNativeException,
ObjectProtoToStringFunc,
UndefinedType,
isCallable,
isType,
type,
isObject,
toUint32,
FunctionType,
NumberType,
throwTypeError,
ObjectProtoToLocaleStringFunc,
ObjectProtoValueOfFunc,
ObjectProtoHasOwnPropertyFunc,
ObjectProtoIsPrototypeOfFunc,
ObjectProtoPropertyIsEnumerableFunc,
addNonEnumerableProperty,
wrapNativeCall
*/

/*****************************************
 *
 * Function Prototype Class
 *
 *****************************************/

/**
 * toString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.4.2
 */
function FunctionProtoToStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(FunctionProtoToStringFunc, FunctionTypeBase);
FunctionProtoToStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (thisVal.className !== 'Function') {
		handleRecoverableNativeException('TypeError', 'Cannot invoke non-function type');
		return new UnknownType();
	}
	return ObjectProtoToStringFunc.prototype.callFunction.apply(this, arguments);
});

/**
 * apply() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.4.2
 */
function FunctionProtoApplyFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(FunctionProtoApplyFunc, FunctionTypeBase);
FunctionProtoApplyFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var thisArg = args[0],
		argArray = args[1],
		i, len,
		argList = [];

	if (!thisArg) {
		thisArg = new UndefinedType();
	}

	if (!isCallable(thisVal)) {
		handleRecoverableNativeException('TypeError', 'Attempted to call non-callable value');
		return new UnknownType();
	}

	if (!argArray || isType(argArray, ['Undefined', 'Null'])) {
		return thisVal.callFunction(thisArg, []);
	}

	if (!isObject(argArray)) {
		handleRecoverableNativeException('TypeError', 'Arguments value is not an object');
		return new UnknownType();
	}

	if (type(argArray) === 'Unknown') {
		for (i = 0, len = toUint32(this.get('length')).value; i < len; i++) {
			argList.push(new UnknownType());
		}
	} else {
		for (i = 0, len = toUint32(argArray.get('length')).value; i < len; i++) {
			argList.push(argArray.get(i));
		}
	}

	return thisVal.callFunction(thisArg, argList);
});

/**
 * call() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.4.2
 */
function FunctionProtoCallFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(FunctionProtoCallFunc, FunctionTypeBase);
FunctionProtoCallFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var thisArg = args[0],
		argList = [],
		i, len;

	if (!thisArg) {
		thisArg = new UndefinedType();
	}

	if (!isCallable(thisVal)) {
		handleRecoverableNativeException('TypeError', 'Attempted to call non-callable value');
		return new UnknownType();
	}

	for (i = 1, len = args.length; i < len; i++) {
		argList.push(args[i]);
	}

	return thisVal.callFunction(thisArg, argList);
});

/**
 * bind() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.4.2
 */
function FunctionProtoBindFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(FunctionProtoBindFunc, FunctionTypeBase);
FunctionProtoBindFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var target = thisVal,
		thisArg = args[0],
		a = args.slice(1),
		f;

	if (!thisArg) {
		thisArg = new UndefinedType();
	}

	if (!isCallable(target)) {
		handleRecoverableNativeException('TypeError', 'Attempted to call non-callable value');
		return new UnknownType();
	}

	// Create the new function
	f = new FunctionType();
	f.targetFunction = target;
	f.boundThis = thisArg;
	f.boundArgs = a;
	f.extensible = true;

	// Set the call method
	f.callFunction = function callFunction(thisVal, extraArgs) {
		return target.callFunction(thisArg, a.concat(extraArgs));
	};

	// Set the construct method
	f.construct = function construct(extraArgs) {
		if (!target.construct) {
			handleRecoverableNativeException('TypeError', 'Bind target does not have a constructor');
			return new UnknownType();
		}
		return target.construct(a.concat(extraArgs));
	};

	// Set the hasInstance method
	f.hasInstance = function hasInstance(v) {
		if (!target.hasInstance) {
			handleRecoverableNativeException('TypeError', 'Bind target does not have a hasInstance method');
			return new UnknownType();
		}
		return target.hasInstance(v);
	};

	// Set the length property
	f.put('length', new NumberType(target.className === 'Function' ?
		Math.max(0, target.get('length').value - a.length) : 0), false, true);

	// Set caller and arguments to thrower
	f.defineOwnProperty('caller', {
		get: throwTypeError,
		set: throwTypeError,
		enumerable: false,
		configurable: false
	}, false, true);
	f.defineOwnProperty('arguments', {
		get: throwTypeError,
		set: throwTypeError,
		enumerable: false,
		configurable: false
	}, false, true);

	return f;
});

/**
 * @classdesc The prototype for Functions
 *
 * @constructor module:base/prototypes/function.FunctionPrototypeType
 * @see ECMA-262 Spec Chapter 15.3.4
 */
exports.FunctionPrototypeType = FunctionPrototypeType;
function FunctionPrototypeType(className) {

	// Warning: setting the third argument to anything falsey, or leaving it off, results in infinite recursion
	FunctionTypeBase.call(this, 0, className || 'Function');

	// Object prototype methods
	addNonEnumerableProperty(this, 'toLocaleString', new ObjectProtoToLocaleStringFunc(), false, true);
	addNonEnumerableProperty(this, 'valueOf', new ObjectProtoValueOfFunc(), false, true);
	addNonEnumerableProperty(this, 'hasOwnProperty', new ObjectProtoHasOwnPropertyFunc(), false, true);
	addNonEnumerableProperty(this, 'isPrototypeOf', new ObjectProtoIsPrototypeOfFunc(), false, true);
	addNonEnumerableProperty(this, 'propertyIsEnumerable', new ObjectProtoPropertyIsEnumerableFunc(), false, true);

	// Function prototype methods
	addNonEnumerableProperty(this, 'toString', new FunctionProtoToStringFunc(), false, true);
	addNonEnumerableProperty(this, 'apply', new FunctionProtoApplyFunc(), false, true);
	addNonEnumerableProperty(this, 'call', new FunctionProtoCallFunc(), false, true);
	addNonEnumerableProperty(this, 'bind', new FunctionProtoBindFunc(), false, true);
}
util.inherits(FunctionPrototypeType, FunctionTypeBase);

/**
 * @classdesc The call method of function prototoypes
 *
 * @method module:base/prototypes/function.FunctionPrototypeType#callFunction
 * @see ECMA-262 Spec Chapter 15.3.4
 */
FunctionPrototypeType.prototype.callFunction = wrapNativeCall(function callFunction() {
	return new UndefinedType();
});

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the error prototype
 *
 * @module base/prototypes/error
 */
/*global
util,
FunctionTypeBase,
areAnyUnknown,
UnknownType,
handleRecoverableNativeException,
type,
StringType,
toString,
addNonEnumerableProperty,
wrapNativeCall
*/

/*****************************************
 *
 * Error Prototype Class
 *
 *****************************************/

/**
 * toString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.11.4.4
 */
function ErrorProtoToStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(ErrorProtoToStringFunc, FunctionTypeBase);
ErrorProtoToStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o = thisVal,
		name,
		msg;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 2
	if (type(o) !== 'Object') {
		handleRecoverableNativeException('TypeError', 'Value is not an object');
		return new UnknownType();
	}

	// Steps 3 and 4
	name = o.get('name');
	if (type(name) === 'Undefined') {
		name = new StringType('Error');
	} else {
		name = toString(name);
	}

	// Steps 5 and 6 (and 7, which seems to be a copy-paste error, go figure)
	msg = o.get('message');
	if (type(msg) === 'Undefined') {
		msg = new StringType('');
	} else {
		msg = toString(msg);
	}

	// Steps 8-10
	if (!name.value) {
		return msg;
	} else if (!msg.value) {
		return name;
	} else {
		return new StringType(name.value + ': ' + msg.value);
	}
});

/**
 * @classdesc The prototype for Errors
 *
 * @constructor module:base/prototypes/error.ErrorPrototypeType
 * @see ECMA-262 Spec Chapter 15.11.4
 */
exports.ErrorPrototypeType = ErrorPrototypeType;
function ErrorPrototypeType(errorType, className) {
	FunctionTypeBase.call(this, 0, className);
	this._errorType = errorType;
	addNonEnumerableProperty(this, 'toString', new ErrorProtoToStringFunc(), false, true);
}
util.inherits(ErrorPrototypeType, FunctionTypeBase);
ErrorPrototypeType.instantiateClone = function instantiateClone(source) {
	return new ErrorPrototypeType(source._errorType, source.className);
};

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the date prototype
 *
 * @module base/prototypes/date
 */
/*global
util,
FunctionTypeBase,
StringType,
NumberType,
toNumber,
ObjectType,
addNonEnumerableProperty,
wrapNativeCall
*/

/*****************************************
 *
 * Date Prototype Class
 *
 *****************************************/

/**
 * toString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.2
 */
function DateProtoToStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoToStringFunc, FunctionTypeBase);
DateProtoToStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new StringType(thisVal._date.toString());
});

/**
 * toDateString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.3
 */
function DateProtoToDateStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoToDateStringFunc, FunctionTypeBase);
DateProtoToDateStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new StringType(thisVal._date.toDateString());
});

/**
 * toTimeString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.4
 */
function DateProtoToTimeStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoToTimeStringFunc, FunctionTypeBase);
DateProtoToTimeStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new StringType(thisVal._date.toTimeString());
});

/**
 * toLocaleString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.5
 */
function DateProtoToLocaleStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoToLocaleStringFunc, FunctionTypeBase);
DateProtoToLocaleStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new StringType(thisVal._date.toLocaleString());
});

/**
 * toLocaleDateString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.6
 */
function DateProtoToLocaleDateStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoToLocaleDateStringFunc, FunctionTypeBase);
DateProtoToLocaleDateStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new StringType(thisVal._date.toLocaleDateString());
});

/**
 * toLocaleTimeString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.7
 */
function DateProtoToLocaleTimeStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoToLocaleTimeStringFunc, FunctionTypeBase);
DateProtoToLocaleTimeStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new StringType(thisVal._date.toLocaleTimeString());
});

/**
 * valueOf() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.8
 */
function DateProtoValueOfFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoValueOfFunc, FunctionTypeBase);
DateProtoValueOfFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.valueOf());
});

/**
 * getTime() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.9
 */
function DateProtoGetTimeFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetTimeFunc, FunctionTypeBase);
DateProtoGetTimeFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getTime());
});

/**
 * getFullYear() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.10
 */
function DateProtoGetFullYearFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetFullYearFunc, FunctionTypeBase);
DateProtoGetFullYearFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getFullYear());
});

/**
 * getUTCFullYear() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.11
 */
function DateProtoGetUTCFullYearFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetUTCFullYearFunc, FunctionTypeBase);
DateProtoGetUTCFullYearFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getUTCFullYear());
});

/**
 * getMonth() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.12
 */
function DateProtoGetMonthFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetMonthFunc, FunctionTypeBase);
DateProtoGetMonthFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getMonth());
});

/**
 * getUTCMonth() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.13
 */
function DateProtoGetUTCMonthFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetUTCMonthFunc, FunctionTypeBase);
DateProtoGetUTCMonthFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getUTCMonth());
});

/**
 * getDate() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.14
 */
function DateProtoGetDateFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetDateFunc, FunctionTypeBase);
DateProtoGetDateFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getDate());
});

/**
 * getUTCDate() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.15
 */
function DateProtoGetUTCDateFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetUTCDateFunc, FunctionTypeBase);
DateProtoGetUTCDateFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getUTCDate());
});

/**
 * getDay() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.16
 */
function DateProtoGetDayFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetDayFunc, FunctionTypeBase);
DateProtoGetDayFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getDay());
});

/**
 * getUTCDay() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.17
 */
function DateProtoGetUTCDayFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetUTCDayFunc, FunctionTypeBase);
DateProtoGetUTCDayFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getUTCDay());
});

/**
 * getHours() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.18
 */
function DateProtoGetHoursFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetHoursFunc, FunctionTypeBase);
DateProtoGetHoursFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getHours());
});

/**
 * getUTCHours() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.19
 */
function DateProtoGetUTCHoursFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetUTCHoursFunc, FunctionTypeBase);
DateProtoGetUTCHoursFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getUTCHours());
});

/**
 * getMinutes() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.20
 */
function DateProtoGetMinutesFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetMinutesFunc, FunctionTypeBase);
DateProtoGetMinutesFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getMinutes());
});

/**
 * getUTCMinutes() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.21
 */
function DateProtoGetUTCMinutesFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetUTCMinutesFunc, FunctionTypeBase);
DateProtoGetUTCMinutesFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getUTCMinutes());
});

/**
 * getSeconds() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.22
 */
function DateProtoGetSecondsFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetSecondsFunc, FunctionTypeBase);
DateProtoGetSecondsFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getSeconds());
});

/**
 * getUTCSeconds() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.23
 */
function DateProtoGetUTCSecondsFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetUTCSecondsFunc, FunctionTypeBase);
DateProtoGetUTCSecondsFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getUTCSeconds());
});

/**
 * getMilliseconds() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.24
 */
function DateProtoGetMillisecondsFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetMillisecondsFunc, FunctionTypeBase);
DateProtoGetMillisecondsFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getMilliseconds());
});

/**
 * getUTCMilliseconds() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.25
 */
function DateProtoGetUTCMillisecondsFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetUTCMillisecondsFunc, FunctionTypeBase);
DateProtoGetUTCMillisecondsFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getUTCMilliseconds());
});

/**
 * getTimezoneOffset() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.26
 */
function DateProtoGetTimezoneOffsetFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoGetTimezoneOffsetFunc, FunctionTypeBase);
DateProtoGetTimezoneOffsetFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new NumberType(thisVal._date.getTimezoneOffset());
});

/**
 * setTime() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.27
 */
function DateProtoSetTimeFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(DateProtoSetTimeFunc, FunctionTypeBase);
DateProtoSetTimeFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	var time = args[0];
	if (time) {
		time = toNumber(time).value;
	}
	return new NumberType(thisVal._date.setTime(time));
});

/**
 * setMilliseconds() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.28
 */
function DateProtoSetMillisecondsFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(DateProtoSetMillisecondsFunc, FunctionTypeBase);
DateProtoSetMillisecondsFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	var ms = args[0];
	if (ms) {
		ms = toNumber(ms).value;
	}
	return new NumberType(thisVal._date.setMilliseconds(ms));
});

/**
 * setUTCMilliseconds() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.29
 */
function DateProtoSetUTCMillisecondsFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(DateProtoSetUTCMillisecondsFunc, FunctionTypeBase);
DateProtoSetUTCMillisecondsFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	var ms = args[0];
	if (ms) {
		ms = toNumber(ms).value;
	}
	return new NumberType(thisVal._date.setUTCMilliseconds(ms));
});

/**
 * setSeconds() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.30
 */
function DateProtoSetSecondsFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(DateProtoSetSecondsFunc, FunctionTypeBase);
DateProtoSetSecondsFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	var sec = args[0],
		ms = args[1];
	if (sec) {
		sec = toNumber(sec).value;
	}
	if (ms) {
		ms = toNumber(ms).value;
	}
	return new NumberType(thisVal._date.setSeconds(sec, ms));
});

/**
 * setUTCSeconds() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.31
 */
function DateProtoSetUTCSecondsFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(DateProtoSetUTCSecondsFunc, FunctionTypeBase);
DateProtoSetUTCSecondsFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	var sec = args[0],
		ms = args[1];
	if (sec) {
		sec = toNumber(sec).value;
	}
	if (ms) {
		ms = toNumber(ms).value;
	}
	return new NumberType(thisVal._date.setUTCSeconds(sec, ms));
});

/**
 * setMinutes() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.32
 */
function DateProtoSetMinutesFunc(className) {
	FunctionTypeBase.call(this, 3, className || 'Function');
}
util.inherits(DateProtoSetMinutesFunc, FunctionTypeBase);
DateProtoSetMinutesFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	var min = args[0],
		sec = args[1],
		ms = args[2];
	if (min) {
		min = toNumber(min).value;
	}
	if (sec) {
		sec = toNumber(sec).value;
	}
	if (ms) {
		ms = toNumber(ms).value;
	}
	return new NumberType(thisVal._date.setMinutes(min, sec, ms));
});

/**
 * setUTCMinutes() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.33
 */
function DateProtoSetUTCMinutesFunc(className) {
	FunctionTypeBase.call(this, 3, className || 'Function');
}
util.inherits(DateProtoSetUTCMinutesFunc, FunctionTypeBase);
DateProtoSetUTCMinutesFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	var min = args[0],
		sec = args[1],
		ms = args[2];
	if (min) {
		min = toNumber(min).value;
	}
	if (sec) {
		sec = toNumber(sec).value;
	}
	if (ms) {
		ms = toNumber(ms).value;
	}
	return new NumberType(thisVal._date.setUTCMinutes(min, sec, ms));
});

/**
 * setHours() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.34
 */
function DateProtoSetHoursFunc(className) {
	FunctionTypeBase.call(this, 4, className || 'Function');
}
util.inherits(DateProtoSetHoursFunc, FunctionTypeBase);
DateProtoSetHoursFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	var hour = args[0],
		min = args[1],
		sec = args[2],
		ms = args[3];
	if (hour) {
		hour = toNumber(hour).value;
	}
	if (min) {
		min = toNumber(min).value;
	}
	if (sec) {
		sec = toNumber(sec).value;
	}
	if (ms) {
		ms = toNumber(ms).value;
	}
	return new NumberType(thisVal._date.setHours(hour, min, sec, ms));
});

/**
 * setUTCHours() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.35
 */
function DateProtoSetUTCHoursFunc(className) {
	FunctionTypeBase.call(this, 4, className || 'Function');
}
util.inherits(DateProtoSetUTCHoursFunc, FunctionTypeBase);
DateProtoSetUTCHoursFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	var hour = args[0],
		min = args[1],
		sec = args[2],
		ms = args[3];
	if (hour) {
		hour = toNumber(hour).value;
	}
	if (min) {
		min = toNumber(min).value;
	}
	if (sec) {
		sec = toNumber(sec).value;
	}
	if (ms) {
		ms = toNumber(ms).value;
	}
	return new NumberType(thisVal._date.setUTCHours(hour, min, sec, ms));
});

/**
 * setDate() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.36
 */
function DateProtoSetDateFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(DateProtoSetDateFunc, FunctionTypeBase);
DateProtoSetDateFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	var date = args[0];
	if (date) {
		date = toNumber(date).value;
	}
	return new NumberType(thisVal._date.setDate(date));
});

/**
 * setUTCDate() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.37
 */
function DateProtoSetUTCDateFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(DateProtoSetUTCDateFunc, FunctionTypeBase);
DateProtoSetUTCDateFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	var date = args[0];
	if (date) {
		date = toNumber(date).value;
	}
	return new NumberType(thisVal._date.setUTCDate(date));
});

/**
 * setMonth() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.38
 */
function DateProtoSetMonthFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(DateProtoSetMonthFunc, FunctionTypeBase);
DateProtoSetMonthFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	var month = args[0],
		date = args[1];
	if (month) {
		month = toNumber(month).value;
	}
	if (date) {
		date = toNumber(date).value;
	}
	return new NumberType(thisVal._date.setMonth(month, date));
});

/**
 * setUTCMonth() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.39
 */
function DateProtoSetUTCMonthFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(DateProtoSetUTCMonthFunc, FunctionTypeBase);
DateProtoSetUTCMonthFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	var month = args[0],
		date = args[1];
	if (month) {
		month = toNumber(month).value;
	}
	if (date) {
		date = toNumber(date).value;
	}
	return new NumberType(thisVal._date.setUTCMonth(month, date));
});

/**
 * setFullYear() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.40
 */
function DateProtoSetFullYearFunc(className) {
	FunctionTypeBase.call(this, 3, className || 'Function');
}
util.inherits(DateProtoSetFullYearFunc, FunctionTypeBase);
DateProtoSetFullYearFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	var year = args[0],
		month = args[1],
		date = args[2];
	if (year) {
		year = toNumber(year).value;
	}
	if (month) {
		month = toNumber(month).value;
	}
	if (date) {
		date = toNumber(date).value;
	}
	return new NumberType(thisVal._date.setFullYear(year, month, date));
});

/**
 * setUTCFullYear() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.41
 */
function DateProtoSetUTCFullYearFunc(className) {
	FunctionTypeBase.call(this, 3, className || 'Function');
}
util.inherits(DateProtoSetUTCFullYearFunc, FunctionTypeBase);
DateProtoSetUTCFullYearFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	var year = args[0],
		month = args[1],
		date = args[2];
	if (year) {
		year = toNumber(year).value;
	}
	if (month) {
		month = toNumber(month).value;
	}
	if (date) {
		date = toNumber(date).value;
	}
	return new StringType(thisVal._date.setUTCFullYear(year, month, date));
});

/**
 * toUTCString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.42
 */
function DateProtoToUTCStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoToUTCStringFunc, FunctionTypeBase);
DateProtoToUTCStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new StringType(thisVal._date.toUTCString());
});

/**
 * toISOString() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.43
 */
function DateProtoToISOStringFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateProtoToISOStringFunc, FunctionTypeBase);
DateProtoToISOStringFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new StringType(thisVal._date.toISOString());
});

/**
 * toJSON() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.5.44
 */
function DateProtoToJSONFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(DateProtoToJSONFunc, FunctionTypeBase);
DateProtoToJSONFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal) {
	return new StringType(thisVal._date.toJSON());
});

/**
 * @classdesc The prototype for Errors
 *
 * @constructor module:base/prototypes/date.DatePrototypeType
 * @see ECMA-262 Spec Chapter 15.9.5
 */
exports.DatePrototypeType = DatePrototypeType;
function DatePrototypeType(className) {
	ObjectType.call(this, className);

	addNonEnumerableProperty(this, 'toString', new DateProtoToStringFunc(), false, true);
	addNonEnumerableProperty(this, 'toDateString', new DateProtoToDateStringFunc(), false, true);
	addNonEnumerableProperty(this, 'toTimeString', new DateProtoToTimeStringFunc(), false, true);
	addNonEnumerableProperty(this, 'toLocaleString', new DateProtoToLocaleStringFunc(), false, true);
	addNonEnumerableProperty(this, 'toLocaleDateString', new DateProtoToLocaleDateStringFunc(), false, true);
	addNonEnumerableProperty(this, 'toLocaleTimeString', new DateProtoToLocaleTimeStringFunc(), false, true);
	addNonEnumerableProperty(this, 'valueOf', new DateProtoValueOfFunc(), false, true);
	addNonEnumerableProperty(this, 'getTime', new DateProtoGetTimeFunc(), false, true);
	addNonEnumerableProperty(this, 'getFullYear', new DateProtoGetFullYearFunc(), false, true);
	addNonEnumerableProperty(this, 'getUTCFullYear', new DateProtoGetUTCFullYearFunc(), false, true);
	addNonEnumerableProperty(this, 'getMonth', new DateProtoGetMonthFunc(), false, true);
	addNonEnumerableProperty(this, 'getUTCMonth', new DateProtoGetUTCMonthFunc(), false, true);
	addNonEnumerableProperty(this, 'getDate', new DateProtoGetDateFunc(), false, true);
	addNonEnumerableProperty(this, 'getUTCDate', new DateProtoGetUTCDateFunc(), false, true);
	addNonEnumerableProperty(this, 'getDay', new DateProtoGetDayFunc(), false, true);
	addNonEnumerableProperty(this, 'getUTCDay', new DateProtoGetUTCDayFunc(), false, true);
	addNonEnumerableProperty(this, 'getHours', new DateProtoGetHoursFunc(), false, true);
	addNonEnumerableProperty(this, 'getUTCHours', new DateProtoGetUTCHoursFunc(), false, true);
	addNonEnumerableProperty(this, 'getMinutes', new DateProtoGetMinutesFunc(), false, true);
	addNonEnumerableProperty(this, 'getUTCMinutes', new DateProtoGetUTCMinutesFunc(), false, true);
	addNonEnumerableProperty(this, 'getSeconds', new DateProtoGetSecondsFunc(), false, true);
	addNonEnumerableProperty(this, 'getUTCSeconds', new DateProtoGetUTCSecondsFunc(), false, true);
	addNonEnumerableProperty(this, 'getMilliseconds', new DateProtoGetMillisecondsFunc(), false, true);
	addNonEnumerableProperty(this, 'getUTCMilliseconds', new DateProtoGetUTCMillisecondsFunc(), false, true);
	addNonEnumerableProperty(this, 'getTimezoneOffset', new DateProtoGetTimezoneOffsetFunc(), false, true);
	addNonEnumerableProperty(this, 'setTime', new DateProtoSetTimeFunc(), false, true);
	addNonEnumerableProperty(this, 'setMilliseconds', new DateProtoSetMillisecondsFunc(), false, true);
	addNonEnumerableProperty(this, 'setUTCMilliseconds', new DateProtoSetUTCMillisecondsFunc(), false, true);
	addNonEnumerableProperty(this, 'setSeconds', new DateProtoSetSecondsFunc(), false, true);
	addNonEnumerableProperty(this, 'setUTCSeconds', new DateProtoSetUTCSecondsFunc(), false, true);
	addNonEnumerableProperty(this, 'setMinutes', new DateProtoSetMinutesFunc(), false, true);
	addNonEnumerableProperty(this, 'setUTCMinutes', new DateProtoSetUTCMinutesFunc(), false, true);
	addNonEnumerableProperty(this, 'setHours', new DateProtoSetHoursFunc(), false, true);
	addNonEnumerableProperty(this, 'setUTCHours', new DateProtoSetUTCHoursFunc(), false, true);
	addNonEnumerableProperty(this, 'setDate', new DateProtoSetDateFunc(), false, true);
	addNonEnumerableProperty(this, 'setUTCDate', new DateProtoSetUTCDateFunc(), false, true);
	addNonEnumerableProperty(this, 'setMonth', new DateProtoSetMonthFunc(), false, true);
	addNonEnumerableProperty(this, 'setUTCMonth', new DateProtoSetUTCMonthFunc(), false, true);
	addNonEnumerableProperty(this, 'setFullYear', new DateProtoSetFullYearFunc(), false, true);
	addNonEnumerableProperty(this, 'setUTCFullYear', new DateProtoSetUTCFullYearFunc(), false, true);
	addNonEnumerableProperty(this, 'toUTCString', new DateProtoToUTCStringFunc(), false, true);
	addNonEnumerableProperty(this, 'toISOString', new DateProtoToISOStringFunc(), false, true);
	addNonEnumerableProperty(this, 'toJSON', new DateProtoToJSONFunc(), false, true);
}
util.inherits(DatePrototypeType, ObjectType);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the number constructor
 *
 * @module base/constructors/number
 */
/*global
util,
FunctionTypeBase,
areAnyUnknown,
UnknownType,
prototypes,
addReadOnlyProperty,
NumberType,
toNumber,
ObjectType,
wrapNativeCall
*/

/*****************************************
 *
 * Number Constructor
 *
 *****************************************/

/**
 * Number constructor function
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.7
 */
function NumberConstructor(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');

	this.defineOwnProperty('prototype', {
		value: prototypes.Number
	}, false, true);

	addReadOnlyProperty(this, 'length', new NumberType(0), false, true);
	addReadOnlyProperty(this, 'MAX_VALUE', new NumberType(Number.MAX_VALUE), false, true);
	addReadOnlyProperty(this, 'MIN_VALUE', new NumberType(Number.MIN_VALUE), false, true);
	addReadOnlyProperty(this, 'NaN', new NumberType(NaN), false, true);
	addReadOnlyProperty(this, 'NEGATIVE_INFINITY', new NumberType(Number.NEGATIVE_INFINITY), false, true);
	addReadOnlyProperty(this, 'POSITIVE_INFINITY', new NumberType(Number.POSITIVE_INFINITY), false, true);
}
util.inherits(NumberConstructor, FunctionTypeBase);
NumberConstructor.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var value = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	return value ? toNumber(value) : new NumberType(0);
});
NumberConstructor.prototype.construct = wrapNativeCall(function construct(args) {

	// Variable declarations
	var value = args[0],
		obj;

	// Validate the parameters
	if (areAnyUnknown(args)) {
		return new UnknownType();
	}

	obj = new ObjectType();
	obj.className = 'Number';
	obj.primitiveValue = value ? toNumber(value).value : 0;

	Object.defineProperty(obj, 'objectPrototype', {
		get: function () {
			return prototypes.Number;
		},
		configurable: true
	});

	return obj;
}, true);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the boolean constructor
 *
 * @module base/constructors/boolean
 */
/*global
util,
FunctionTypeBase,
areAnyUnknown,
UnknownType,
BooleanType,
prototypes,
toBoolean,
ObjectType,
wrapNativeCall
*/

/*****************************************
 *
 * Boolean Constructor
 *
 *****************************************/

/**
 * Boolean constructor function
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.6
 */
function BooleanConstructor(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');

	this.defineOwnProperty('prototype', {
		value: prototypes.Boolean
	}, false, true);
}
util.inherits(BooleanConstructor, FunctionTypeBase);
BooleanConstructor.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var value = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	return value ? toBoolean(value) : new BooleanType(false);
});
BooleanConstructor.prototype.construct = wrapNativeCall(function construct(args) {

	// Variable declarations
	var value = args[0],
		obj;

	// Validate the parameters
	if (areAnyUnknown(args)) {
		return new UnknownType();
	}

	obj = new ObjectType();
	obj.className = 'Boolean';
	obj.primitiveValue = value ? toBoolean(value).value : false;

	Object.defineProperty(obj, 'objectPrototype', {
		get: function () {
			return prototypes.Boolean;
		},
		configurable: true
	});

	return obj;
}, true);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the string constructor
 *
 * @module base/constructors/string
 */
/*global
util,
FunctionTypeBase,
areAnyUnknown,
UnknownType,
BaseType,
prototypes,
toUint16,
StringType,
toString,
ObjectType,
NumberType,
wrapNativeCall,
addNonEnumerableProperty
*/

/*****************************************
 *
 * String Constructor
 *
 *****************************************/

/**
 * isArray() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5.3.2
 */
function StringFromCharCodeFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(StringFromCharCodeFunc, FunctionTypeBase);
StringFromCharCodeFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var i, len;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Convert the array to something we can apply()
	for (i = 0, len = args.length; i < len; i++) {
		args[i] = toUint16(args[i]).value;
	}

	// Use the built-in match method to perform the match
	return new StringType(String.fromCharCode.apply(this, args));
});

/**
 * String constructor function
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.5, 15.5.5.2
 */
function StringConstructor(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');

	this.defineOwnProperty('prototype', {
		value: prototypes.String
	}, false, true);

	addNonEnumerableProperty(this, 'fromCharCode', new StringFromCharCodeFunc());
}
util.inherits(StringConstructor, FunctionTypeBase);
StringConstructor.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var value = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	return value ? toString(value) : new StringType('');
});
StringConstructor.prototype.construct = wrapNativeCall(function construct(args) {

	// Variable declarations
	var value = args[0],
		obj;

	// Validate the parameters
	if (areAnyUnknown(args)) {
		return new UnknownType();
	}

	obj = new ObjectType();
	obj.className = 'String';
	obj.primitiveValue = value ? toString(value).value : '';

	obj.defineOwnProperty('length', { value: new NumberType(obj.primitiveValue.length) }, false, true);

	obj._getOwnProperty = obj.getOwnProperty;

	Object.defineProperty(obj, 'objectPrototype', {
		get: function () {
			return prototypes.String;
		},
		configurable: true
	});

	obj._getPropertyNames = StringType.prototype._getPropertyNames;


	// From the spec 15.5.5.2
	obj._lookupProperty = function _lookupProperty(p) {
		var current = BaseType.prototype._lookupProperty.call(this, p),
			index;
		if (current) {
			return current;
		}

		// Step 5
		index = +p;

		// Step 4
		if (Math.abs(index) + '' !== p) {
			return;
		}

		// Step 7
		if (index >= this.primitiveValue.length) {
			return;
		}

		// Steps 8-9
		return {
			value: new StringType(this.primitiveValue[index]),
			enumerable: true,
			writable: true,
			configurable: true
		};
	};

	obj._getPropertyNames = function _getPropertyNames() {
		var props = [],
			val = this.primitiveValue,
			i, len;
		for (i = 0, len = val.length; i < len; i++) {
			props.push(i.toString());
		}
		return props.concat(BaseType.prototype._getPropertyNames.call(this));
	};

	return obj;
}, true);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the object constructor
 *
 * @module base/constructors/object
 */
/*global
util,
FunctionTypeBase,
areAnyUnknown,
UnknownType,
BooleanType,
prototypes,
type,
handleRecoverableNativeException,
toString,
fromPropertyDescriptor,
ArrayType,
ObjectType,
toPropertyDescriptor,
toObject,
isDataDescriptor,
StringType,
isType,
wrapNativeCall,
addNonEnumerableProperty,
NullType
*/

/*****************************************
 *
 * Object Constructor
 *
 *****************************************/

/**
 * getPrototypeOf() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.3.2
 */
function ObjectGetPrototypeOfFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ObjectGetPrototypeOfFunc, FunctionTypeBase);
ObjectGetPrototypeOfFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (!o || type(o) !== 'Object') {
		handleRecoverableNativeException('TypeError', 'Value is not an object');
		return new UnknownType();
	}
	return o.objectPrototype ? o.objectPrototype : new NullType();
});

/**
 * getOwnPropertyDescriptor() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.3.3
 */
function ObjectGetOwnPropertyDescriptorFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(ObjectGetOwnPropertyDescriptorFunc, FunctionTypeBase);
ObjectGetOwnPropertyDescriptorFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o = args[0],
		p = args[1],
		name;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	if (type(o) !== 'Object') {
		handleRecoverableNativeException('TypeError', 'Value is not an object');
		return new UnknownType();
	}

	// Step 2
	name = toString(p).value;

	// Steps 3 and 4
	return fromPropertyDescriptor(o.getOwnProperty(name));
});

/**
 * getOwnPropertyNames() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.3.4
 */
function ObjectGetOwnPropertyNamesFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ObjectGetOwnPropertyNamesFunc, FunctionTypeBase);
ObjectGetOwnPropertyNamesFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o = args[0],
		array,
		n = 0;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	if (!o || type(o) !== 'Object') {
		handleRecoverableNativeException('TypeError', 'Value is not an object');
		return new UnknownType();
	}

	// Step 2
	array = new ArrayType();

	// Step 4
	o._getPropertyNames().forEach(function (name) {
		array.defineOwnProperty(n, {
			value: new StringType(name),
			writable: true,
			enumerable: true,
			configurable: true
		}, false, true);
		n++;
	});

	// Step 5
	return array;
});

/**
 * create() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.3.5
 */
function ObjectCreateFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(ObjectCreateFunc, FunctionTypeBase);
ObjectCreateFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o = args[0],
		properties = args[1],
		obj;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	if (!o || (type(o) != 'Object' && type(o) != 'Null')) {
		handleRecoverableNativeException('TypeError', 'Value is not an object');
		return new UnknownType();
	}

	// Step 2
	obj = new ObjectType();

	// Step 3
	obj.objectPrototype = o;

	// Step 4
	if (properties && type(properties) !== 'Undefined') {
		ObjectDefinePropertiesFunc.prototype.callFunction(thisVal, [obj, properties]);
	}

	// Step 5
	return obj;
});

/**
 * defineProperties() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.3.6
 */
function ObjectDefinePropertyFunc(className) {
	FunctionTypeBase.call(this, 3, className || 'Function');
}
util.inherits(ObjectDefinePropertyFunc, FunctionTypeBase);
ObjectDefinePropertyFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o = args[0],
		p = args[1],
		attributes = args[2],
		name,
		desc;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	if (!o || type(o) !== 'Object') {
		handleRecoverableNativeException('TypeError', 'Value is not an object');
		return new UnknownType();
	}

	// Step 2
	name = toString(p).value;

	// Step 3
	desc = toPropertyDescriptor(attributes);

	// Step 4
	o.defineOwnProperty(name, desc, true);

	// Step 5
	return o;
});

/**
 * defineProperties() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.3.7
 */
function ObjectDefinePropertiesFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(ObjectDefinePropertiesFunc, FunctionTypeBase);
ObjectDefinePropertiesFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o,
		properties,
		props,
		names,
		i,
		len,
		p;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	o = args[0];
	properties = args[1];
	props = toObject(properties);
	names = props._getPropertyNames();

	// Step 1
	if (!o || type(o) !== 'Object') {
		handleRecoverableNativeException('TypeError', 'Value is not an object');
		return new UnknownType();
	}

	// Steps 5 and 6
	for (i = 0, len = names.length; i < len; i++) {
		p = names[i];
		if (props.getProperty(p).enumerable) {
			o.defineOwnProperty(p, toPropertyDescriptor(props.get(p)), true);
		}
	}

	// Step 7
	return o;
});

/**
 * seal() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.3.8
 */
function ObjectSealFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ObjectSealFunc, FunctionTypeBase);
ObjectSealFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o = args[0],
		desc;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	if (!o || type(o) !== 'Object') {
		handleRecoverableNativeException('TypeError', 'Value is not an object');
		return new UnknownType();
	}

	// Step 2
	o._getPropertyNames().forEach(function (p) {
		desc = o.getOwnProperty(p);
		desc.configurable = false;
		o.defineOwnProperty(p, desc, true);
	});

	// Step 3
	o.extensible = false;

	// Step 4
	return o;
});

/**
 * freeze() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.3.9
 */
function ObjectFreezeFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ObjectFreezeFunc, FunctionTypeBase);
ObjectFreezeFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o = args[0],
		desc;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	if (!o || type(o) !== 'Object') {
		handleRecoverableNativeException('TypeError', 'Value is not an object');
		return new UnknownType();
	}

	// Step 2
	o._getPropertyNames().forEach(function (p) {
		desc = o.getOwnProperty(p);
		if (isDataDescriptor(desc)) {
			desc.writable = false;
		}
		desc.configurable = false;
		o.defineOwnProperty(p, desc, true);
	});

	// Step 3
	o.extensible = false;

	// Step 4
	return o;
});

/**
 * preventExtensions() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.3.10
 */
function ObjectPreventExtensionsFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ObjectPreventExtensionsFunc, FunctionTypeBase);
ObjectPreventExtensionsFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	if (!o || type(o) !== 'Object') {
		handleRecoverableNativeException('TypeError', 'Value is not an object');
		return new UnknownType();
	}

	// Step 2
	o.extensible = false;

	// Step 3
	return o;
});

/**
 * isSealed() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.3.11
 */
function ObjectIsSealedFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ObjectIsSealedFunc, FunctionTypeBase);
ObjectIsSealedFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	if (!o || type(o) !== 'Object') {
		handleRecoverableNativeException('TypeError', 'Value is not an object');
		return new UnknownType();
	}

	// Step 2
	o._getPropertyNames().forEach(function (p) {
		if (o.getOwnProperty(p).configurable) {
			return new BooleanType(false);
		}
	});

	// Step 3
	return new BooleanType(!o.extensible);
});

/**
 * isFrozen() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.3.12
 */
function ObjectIsFrozenFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ObjectIsFrozenFunc, FunctionTypeBase);
ObjectIsFrozenFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o = args[0],
		desc;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	if (!o || type(o) !== 'Object') {
		handleRecoverableNativeException('TypeError', 'Value is not an object');
		return new UnknownType();
	}

	// Step 2
	o._getPropertyNames().forEach(function (p) {
		desc = o.getOwnProperty(p);
		if ((isDataDescriptor(desc) && desc.writable) || desc.configurable) {
			return new BooleanType(false);
		}
	});

	// Step 3
	return new BooleanType(!o.extensible);
});

/**
 * isExtensible() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.3.13
 */
function ObjectIsExtensibleFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ObjectIsExtensibleFunc, FunctionTypeBase);
ObjectIsExtensibleFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	if (!o || type(o) !== 'Object') {
		handleRecoverableNativeException('TypeError', 'Value is not an object');
		return new UnknownType();
	}

	// Step 2
	return new BooleanType(o.extensible);
});

/**
 * keys() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2.3.14
 */
function ObjectKeysFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ObjectKeysFunc, FunctionTypeBase);
ObjectKeysFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var o = args[0],
		array,
		index = 0;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	if (!o || type(o) !== 'Object') {
		handleRecoverableNativeException('TypeError', 'Value is not an object');
		return new UnknownType();
	}

	// Step 3
	array = new ArrayType();

	// Step 5
	o._getPropertyNames().forEach(function (p) {
		if (o._lookupProperty(p).enumerable) {
			array.defineOwnProperty(index, {
				value: new StringType(p),
				writable: true,
				enumerable: true,
				configurable: true
			}, false);
			index++;
		}
	});

	// Step 6
	return array;
});

/**
 * Object constructor function
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.2
 */
function ObjectConstructor(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');

	this.defineOwnProperty('prototype', {
		value: prototypes.Object
	}, false, true);

	addNonEnumerableProperty(this, 'getPrototypeOf', new ObjectGetPrototypeOfFunc());
	addNonEnumerableProperty(this, 'getOwnPropertyDescriptor', new ObjectGetOwnPropertyDescriptorFunc());
	addNonEnumerableProperty(this, 'getOwnPropertyNames', new ObjectGetOwnPropertyNamesFunc());
	addNonEnumerableProperty(this, 'create', new ObjectCreateFunc());
	addNonEnumerableProperty(this, 'defineProperty', new ObjectDefinePropertyFunc());
	addNonEnumerableProperty(this, 'defineProperties', new ObjectDefinePropertiesFunc());
	addNonEnumerableProperty(this, 'seal', new ObjectSealFunc());
	addNonEnumerableProperty(this, 'freeze', new ObjectFreezeFunc());
	addNonEnumerableProperty(this, 'preventExtensions', new ObjectPreventExtensionsFunc());
	addNonEnumerableProperty(this, 'isSealed', new ObjectIsSealedFunc());
	addNonEnumerableProperty(this, 'isFrozen', new ObjectIsFrozenFunc());
	addNonEnumerableProperty(this, 'isExtensible', new ObjectIsExtensibleFunc());
	addNonEnumerableProperty(this, 'keys', new ObjectKeysFunc());
}
util.inherits(ObjectConstructor, FunctionTypeBase);
ObjectConstructor.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var value = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	if (!value || isType(value, ['Null', 'Undefined'])) {
		return new ObjectType();
	}

	// Step 2
	return toObject(value);
});
ObjectConstructor.prototype.construct = wrapNativeCall(function construct(args) {

	// Variable declarations
	var value = args[0];

	// Validate the parameters
	if (areAnyUnknown(args)) {
		return new UnknownType();
	}

	// Step 1
	if (value && (!isType(value, ['Undefined', 'Null']))) {
		if (type(value) === 'Object') {
			return value;
		} else {
			return toObject(value);
		}
	}

	// Steps 3-8
	return new ObjectType();
}, true);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the array constructor
 *
 * @module base/constructors/array
 */
/*global
util,
FunctionTypeBase,
areAnyUnknown,
UnknownType,
BooleanType,
type,
prototypes,
ArrayType,
toUint32,
handleRecoverableNativeException,
addNonEnumerableProperty,
NumberType,
wrapNativeCall
*/

/*****************************************
 *
 * Array Constructor
 *
 *****************************************/

/**
 * isArray() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4.3.2
 */
function ArrayIsArrayFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ArrayIsArrayFunc, FunctionTypeBase);
ArrayIsArrayFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var arg = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1 and 2
	return new BooleanType(type(arg) === 'Object' && arg.className === 'Array');
});

/**
 * Array constructor function
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.4
 */
function ArrayConstructor(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');

	this.defineOwnProperty('prototype', {
		value: prototypes.Array
	}, false, true);

	addNonEnumerableProperty(this, 'isArray', new ArrayIsArrayFunc());
}
util.inherits(ArrayConstructor, FunctionTypeBase);
ArrayConstructor.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	return ArrayConstructor.prototype.construct.call(this, args);
});
ArrayConstructor.prototype.construct = wrapNativeCall(function construct(args) {

	// Variable declarations
	var array,
		i, len;

	// Validate the parameters
	if (areAnyUnknown(args)) {
		return new UnknownType();
	}

	array = new ArrayType();
	if (args.length === 1) {
		len = args[0];
		if (type(len) === 'Number') {
			if (len.value === toUint32(len).value) {
				array._addProperty('length', {
					value: toUint32(len),
					writable: true,
					enumerable: false,
					configurable: false
				});
			} else {
				handleRecoverableNativeException('RangeError', 'Invalid length ' + len.value);
				return new UnknownType();
			}
		} else {
			array._addProperty('length', {
				value: new NumberType(1),
				writable: true,
				enumerable: false,
				configurable: false
			});
			array.put('0', len, true);
		}
	} else if (args.length > 1){
		len = args.length;
		array._addProperty('length', {
			value: new NumberType(len),
			writable: true,
			enumerable: false,
			configurable: false
		});
		for (i = 0; i < len; i++) {
			array.put(i, args[i], true);
		}
	}

	return array;
}, true);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the regexp constructor
 *
 * @module base/constructors/regexp
 */
/*global
util,
FunctionTypeBase,
areAnyUnknown,
UnknownType,
prototypes,
type,
handleRecoverableNativeException,
toString,
RegExpType,
StringType,
wrapNativeCall
*/

/*****************************************
 *
 * RegExp Constructor
 *
 *****************************************/

/**
 * RegExp constructor function
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.10
 */
function RegExpConstructor(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');

	this.defineOwnProperty('prototype', {
		value: prototypes.RegExp
	}, false, true);
}
util.inherits(RegExpConstructor, FunctionTypeBase);
RegExpConstructor.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var pattern = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (pattern && type(pattern) === 'Object' && pattern.className === 'RegExp') {
		return pattern;
	}

	return RegExpConstructor.prototype.construct(args);
});
RegExpConstructor.prototype.construct = wrapNativeCall(function construct(args) {

	// Variable declarations
	var pattern = args[0] || new StringType(''),
		flags = args[1],
		p,
		f;

	// Validate the parameters
	if (areAnyUnknown(args)) {
		return new UnknownType();
	}

	// Parse the parameters
	if (type(pattern) === 'Object' && pattern.className === 'RegExp') {
		if (flags && type(flags) !== 'Undefined') {
			handleRecoverableNativeException('TypeError', 'Invalid flag type');
			return new UnknownType();
		}
		p = pattern._pattern;
		f = pattern._flags;
	} else {
		p = pattern && type(pattern) !== 'Undefined' ? toString(pattern).value : '';
		f = flags && type(flags) !== 'Undefined' ? toString(flags).value : '';
	}

	// Create the regex object
	return new RegExpType(p, f);
}, true);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the function constructor
 *
 * @module base/constructors/function
 */
/*global
util,
AST,
FunctionTypeBase,
areAnyUnknown,
UnknownType,
prototypes,
StringType,
toString,
handleRecoverableNativeException,
FunctionType,
RuleProcessor,
wrapNativeCall,
getModuleContext
*/

/*****************************************
 *
 * Function Constructor
 *
 *****************************************/

/**
 * Function constructor function
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.3
 */
function FunctionConstructor(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');

	this.defineOwnProperty('prototype', {
		value: prototypes.Function
	}, false, true);
}
util.inherits(FunctionConstructor, FunctionTypeBase);
FunctionConstructor.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {
	return FunctionConstructor.prototype.construct.call(this, args);
});
FunctionConstructor.prototype.construct = wrapNativeCall(function construct(args) {

	// Variable declarations
	var argCount = args.length,
		p = '',
		body,
		k = 1,
		i;

	// Validate the parameters
	if (areAnyUnknown(args)) {
		return new UnknownType();
	}

	// Step 3
	if (argCount === 0) {
		body = new StringType();

	// Step 4
	} else if (argCount === 1) {
		body = args[0];

	// Step 5
	} else if (argCount > 1) {
		p = toString(args[0]).value;
		while (k < argCount - 1) {
			p += ',' + toString(args[k]).value;
			k++;
		}
		body = args[k];
	}

	// Step 6
	body = toString(body).value;

	// Step 7
	p = AST.parseString('function temp(' + p + '){}');
	if (p.syntaxError) {
		handleRecoverableNativeException('SyntaxError', p.message);
		return new UnknownType();
	}
	p = p.body[0].argnames;
	for (i = 0; i < p.length; i++) {
		p[i] = p[i].name;
	}

	// Step 8
	body = AST.parseString('function temp(){' + body + '}');
	if (body.syntaxError) {
		handleRecoverableNativeException('SyntaxError', p.message);
		return new UnknownType();
	}
	body = body.body[0];

	// Step 10
	return new FunctionType(p, body, getModuleContext().lexicalEnvironment, RuleProcessor.isBlockStrict(body));
}, true);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the error constructor
 *
 * @module base/constructors/error
 */
/*global
util,
FunctionTypeBase,
areAnyUnknown,
UnknownType,
prototypes,
ObjectType,
StringType,
toString,
type,
wrapNativeCall
*/

/*****************************************
 *
 * Error Constructor
 *
 *****************************************/

/**
 * Error constructor function
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.11
 */
exports.ErrorConstructor = ErrorConstructor;
function ErrorConstructor(errorType, className) {
	FunctionTypeBase.call(this, 1, className || 'Function');

	this.defineOwnProperty('prototype', {
		value: prototypes[errorType]
	}, false, true);

	this._errorType = errorType;
}
util.inherits(ErrorConstructor, FunctionTypeBase);
ErrorConstructor.instantiateClone = function instantiateClone(source) {
	return new ErrorConstructor(source._errorType, source.className);
};
ErrorConstructor.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	return ErrorConstructor.prototype.construct.call(this, args);
});
ErrorConstructor.prototype.construct = wrapNativeCall(function construct(args) {

	// Variable declarations
	var errorType = this._errorType,
		err,
		message = args[0];

	// Validate the parameters
	if (areAnyUnknown(args)) {
		return new UnknownType();
	}

	err = new ObjectType(errorType, undefined, true);
	err.extensible = true;

	Object.defineProperty(err, 'objectPrototype', {
		get: function () {
			return prototypes[errorType];
		},
		configurable: true
	});

	err.put('name', new StringType(errorType), true);
	err.put('message', message && type(message) !== 'Undefined' ? toString(message) : new StringType(''), true);

	return err;
}, true);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Definition for the date constructor
 *
 * @module base/constructors/date
 */
/*global
util,
Runtime,
FunctionTypeBase,
addNonEnumerableProperty,
UnknownType,
prototypes,
NumberType,
StringType,
type,
toNumber,
ObjectType,
wrapNativeCall
*/

/*****************************************
 *
 * Date Constructor
 *
 *****************************************/

/**
 * parse() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.4.2
 */
function DateParseFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateParseFunc, FunctionTypeBase);
DateParseFunc.prototype.callFunction = wrapNativeCall(function callFunction() {
	return new UnknownType();
});

/**
 * UTC() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.4.3
 */
function DateUTCFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateUTCFunc, FunctionTypeBase);
DateUTCFunc.prototype.callFunction = wrapNativeCall(function callFunction() {
	return new UnknownType();
});

/**
 * now() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9.4.4
 */
function DateNowFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(DateNowFunc, FunctionTypeBase);
DateNowFunc.prototype.callFunction = wrapNativeCall(function callFunction() {
	if (Runtime.options.exactMode) {
		return new NumberType(Date.now());
	} else {
		return new UnknownType();
	}
});

/**
 * Date constructor function
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.9
 */
function DateConstructor(className) {
	FunctionTypeBase.call(this, 7, className || 'Function');

	this.defineOwnProperty('prototype', {
		value: prototypes.Date
	}, false, true);

	addNonEnumerableProperty(this, 'parse', new DateParseFunc());
	addNonEnumerableProperty(this, 'UTC', new DateUTCFunc());
	addNonEnumerableProperty(this, 'now', new DateNowFunc());
}
util.inherits(DateConstructor, FunctionTypeBase);
DateConstructor.prototype.callFunction = wrapNativeCall(function callFunction() {
	if (Runtime.options.exactMode) {
		return new StringType(Date());
	} else {
		return new UnknownType();
	}
});
DateConstructor.prototype.construct = wrapNativeCall(function construct(args) {
	var dateObj,
		internalDateObj,
		convertedArgs,
		i, len;
	if (Runtime.options.exactMode) {
		if (args.length === 0) {
			internalDateObj = new Date();
		} else if (args.length === 1){
			if (type(args[0]) === 'String') {
				internalDateObj = new Date(args[0].value);
			} else {
				internalDateObj = new Date(toNumber(args[0]).value);
			}
		} else {
			convertedArgs = [];
			for (i = 0, len = args.length; i < len; i++) {
				convertedArgs[i] = toNumber(args[i]).value;
			}
			switch(args.length) {
				case 2:
					internalDateObj = new Date(
						convertedArgs[0],
						convertedArgs[1]);
					break;
				case 3:
					internalDateObj = new Date(
						convertedArgs[0],
						convertedArgs[1],
						convertedArgs[2]);
					break;
				case 4:
					internalDateObj = new Date(
						convertedArgs[0],
						convertedArgs[1],
						convertedArgs[2],
						convertedArgs[3]);
					break;
				case 5:
					internalDateObj = new Date(
						convertedArgs[0],
						convertedArgs[1],
						convertedArgs[2],
						convertedArgs[3],
						convertedArgs[4]);
					break;
				case 6:
					internalDateObj = new Date(
						convertedArgs[0],
						convertedArgs[1],
						convertedArgs[2],
						convertedArgs[3],
						convertedArgs[4],
						convertedArgs[5]);
					break;
				case 7:
					internalDateObj = new Date(
						convertedArgs[0],
						convertedArgs[1],
						convertedArgs[2],
						convertedArgs[3],
						convertedArgs[4],
						convertedArgs[5],
						convertedArgs[6]);
					break;
			}
		}
		dateObj = new ObjectType();
		dateObj._date = internalDateObj;
		Object.defineProperty(dateObj, 'objectPrototype', {
			get: function () {
				return prototypes.Date;
			},
			configurable: true
		});
		return dateObj;
	} else {
		return new UnknownType();
	}
}, true);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Contains conversion methods for types
 *
 * @module base/conversion
 */
/*global
type,
UnknownType,
BooleanType,
NumberType,
StringType,
ObjectType,
UndefinedType,
prototypes,
handleRecoverableNativeException,
throwNativeException,
isType,
isDataDescriptor
*/

/*****************************************
 *
 * Type Conversion
 *
 *****************************************/

/**
 * ECMA-262 Spec: <em>The abstract operation ToPrimitive takes an input argument and an optional argument PreferredType.
 * The abstract operation ToPrimitive converts its input argument to a non-Object type. If an object is capable of
 * converting to more than one primitive type, it may use the optional hint PreferredType to favour that type.</em>
 *
 * @method module:base/conversion.toPrimitive
 * @param {module:base.BaseType} input The value to convert
 * @param {string} preferredType The preferred type to convert to
 * @return {module:base.BaseType} The converted value
 * @see ECMA-262 Spec Chapter 9.1
 */
exports.toPrimitive = toPrimitive;
function toPrimitive(input, preferredType) {
	input = input || new UndefinedType();
	switch(type(input)) {
		case 'Object':
			return input.defaultValue(preferredType);
		case 'Unknown':
			return new UnknownType();
		default:
			return input;
	}
}

/**
 * ECMA-262 Spec: <em>The abstract operation ToBoolean converts its argument to a value of type Boolean</em>
 *
 * @method module:base/conversion.toBoolean
 * @param {module:base.BaseType} input The value to convert
 * @return {module:base/types/boolean.BooleanType} The converted value
 * @see ECMA-262 Spec Chapter 9.2
 */
exports.toBoolean = toBoolean;
function toBoolean(input) {
	var newBoolean = new BooleanType();
	input = input || new UndefinedType();
	switch (type(input)) {
		case 'Undefined':
			newBoolean.value = false;
			break;
		case 'Null':
			newBoolean.value = false;
			break;
		case 'Boolean':
			newBoolean.value = input.value;
			break;
		case 'Number':
			newBoolean.value = !!input.value;
			break;
		case 'String':
			newBoolean.value = !!input.value;
			break;
		case 'Object':
			newBoolean.value = true;
			break;
		case 'Unknown':
			return new UnknownType();
	}
	return newBoolean;
}

/**
 * ECMA-262 Spec: <em>The abstract operation ToNumber converts its argument to a value of type Number</em>
 *
 * @method module:base/conversion.toNumber
 * @param {module:base.BaseType} input The value to convert
 * @return {module:base/types/number.NumberType} The converted value
 * @see ECMA-262 Spec Chapter 9.3
 */
exports.toNumber = toNumber;
function toNumber(input) {
	var newNumber = new NumberType();
	input = input || new UndefinedType();
	switch (type(input)) {
		case 'Undefined':
			newNumber.value = NaN;
			break;
		case 'Null':
			newNumber.value = 0;
			break;
		case 'Boolean':
			newNumber.value = input.value ? 1 : 0;
			break;
		case 'Number':
			newNumber.value = input.value;
			break;
		case 'String':
			newNumber.value = +input.value;
			break;
		case 'Object':
			newNumber = toNumber(toPrimitive(input, 'Number'));
			break;
		case 'Unknown':
			return new UnknownType();
	}
	return newNumber;
}

/**
 * ECMA-262 Spec: <em>The abstract operation ToInteger converts its argument to an integral numeric value.</em>
 *
 * @method module:base/conversion.toInteger
 * @param {module:base.BaseType} input The value to convert
 * @return {module:base/types/number.NumberType} The converted value
 * @see ECMA-262 Spec Chapter 9.4
 */
exports.toInteger = toInteger;
function toInteger(input) {
	var newNumber = toNumber(input),
		sign;
	if (type(newNumber) === 'Unknown') {
		return new UnknownType();
	} else if (isNaN(newNumber.value)) {
		newNumber.value = 0;
	} else {
		sign = newNumber.value < 0 ? -1 : 1;
		newNumber.value = sign * Math.floor(Math.abs(newNumber.value));
	}
	return newNumber;
}

/**
 * ECMA-262 Spec: <em>The abstract operation ToInt32 converts its argument to one of 2^32 integer values in the range
 * -2^31 through 2^31 - 1, inclusive.</em>
 *
 * @method module:base/conversion.toInt32
 * @param {module:base.BaseType} input The value to convert
 * @return {module:base/types/number.NumberType} The converted value
 * @see ECMA-262 Spec Chapter 9.5
 */
exports.toInt32 = toInt32;
function toInt32(input) {
	var newNumber = toNumber(input),
		sign;
	if (type(newNumber) === 'Unknown') {
		return new UnknownType();
	} else if (isNaN(newNumber.value) || newNumber.value === Infinity || newNumber.value === -Infinity) {
		newNumber.value = 0;
	} else {
		sign = newNumber.value < 0 ? -1 : 1;
		newNumber.value = sign * Math.floor(Math.abs(newNumber.value)) % Math.pow(2, 32);
		if (newNumber.value >= Math.pow(2, 31)) {
			newNumber.value -= Math.pow(2, 32);
		}
	}
	return newNumber;
}

/**
 * ECMA-262 Spec: <em>The abstract operation ToUint32 converts its argument to one of 2^32 integer values in the range 0
 * through 2^32 - 1, inclusive.</em>
 *
 * @method module:base/conversion.toUint32
 * @param {module:base.BaseType} input The value to convert
 * @return {module:base/types/number.NumberType} The converted value
 * @see ECMA-262 Spec Chapter 9.6
 */
exports.toUint32 = toUint32;
function toUint32(input) {
	var newNumber = toNumber(input),
		sign;
	if (type(newNumber) === 'Unknown') {
		return new UnknownType();
	} else if (isNaN(newNumber.value) || newNumber.value === Infinity || newNumber.value === -Infinity) {
		newNumber.value = 0;
	} else {
		sign = newNumber.value < 0 ? -1 : 1;
		newNumber.value = sign * Math.floor(Math.abs(newNumber.value)) % Math.pow(2, 32);
	}
	return newNumber;
}

/**
 * ECMA-262 Spec: <em>The abstract operation ToUint16 converts its argument to one of 2^16 integer values in the range 0
 * through 2^16 - 1, inclusive.</em>
 *
 * @method module:base/conversion.toUint16
 * @param {module:base.BaseType} input The value to convert
 * @return {module:base/types/number.NumberType} The converted value
 * @see ECMA-262 Spec Chapter 9.7
 */
exports.toUint16 = toUint16;
function toUint16(input) {
	var newNumber = toNumber(input),
		sign;
	if (type(newNumber) === 'Unknown') {
		return new UnknownType();
	} else if (isNaN(newNumber.value) || newNumber.value === Infinity || newNumber.value === -Infinity) {
		newNumber.value = 0;
	} else {
		sign = newNumber.value < 0 ? -1 : 1;
		newNumber.value = sign * Math.floor(Math.abs(newNumber.value)) % Math.pow(2, 16);
	}
	return newNumber;
}

/**
 * ECMA-262 Spec: <em>The abstract operation ToString converts its argument to a value of type String</em>
 *
 * @method module:base/conversion.toString
 * @param {module:base.BaseType} input The value to convert
 * @return {module:base/types/string.StringType} The converted value
 * @see ECMA-262 Spec Chapter 9.8
 */
exports.toString = toString;
function toString(input) {
	var newString;
	input = input || new UndefinedType();
	if (type(input) === 'Unknown') {
		newString = new UnknownType();
	} else if (type(input) === 'Object') {
		newString = toString(toPrimitive(input, 'String'));
	} else {
		newString = new StringType();
		newString.value = input.value + '';
	}
	return newString;
}

/**
 * ECMA-262 Spec: <em>The abstract operation ToObject converts its argument to a value of type Object</em>
 *
 * @method module:base/conversion.toObject
 * @param {module:base.BaseType} input The value to convert
 * @return {module:base/types/object.ObjectType} The converted value
 * @see ECMA-262 Spec Chapter 9.9
 */
exports.toObject = toObject;
function toObject(input) {
	var newObject;
	input = input || new UndefinedType();
	switch (type(input)) {
		case 'Boolean':
			newObject = new ObjectType();
			newObject.className = 'Boolean';
			newObject.primitiveValue = input.value;

			Object.defineProperty(newObject, 'objectPrototype', {
				get: function () {
					return prototypes.Boolean;
				},
				configurable: true
			});

			return newObject;
		case 'Number':
			newObject = new ObjectType();
			newObject.className = 'Number';
			newObject.primitiveValue = input.value;

			Object.defineProperty(newObject, 'objectPrototype', {
				get: function () {
					return prototypes.Number;
				},
				configurable: true
			});

			return newObject;
		case 'String':
			newObject = new ObjectType();
			newObject.className = 'String';
			newObject.primitiveValue = input.value;

			Object.defineProperty(newObject, 'objectPrototype', {
				get: function () {
					return prototypes.String;
				},
				configurable: true
			});

			newObject._properties = input._properties;
			return newObject;
		case 'Object':
			return input;
		case 'Unknown':
			return new UnknownType();
		default:
			handleRecoverableNativeException('TypeError', 'Values of type ' + type(input) + ' cannot be converted to objects');
			return new UnknownType();
	}
}



/**
 * Converts a property descriptor to a generic object.
 *
 * @method module:base/conversion.fromPropertyDescriptor
 * @param {module:base/types/object.DataPropertyDescriptor|module:base/types/object.AccessorPropertyDescriptor|Object} The property descriptor to convert
 * @return {(module:base/types/undefined.UndefinedType | module:base/types/object.ObjectType)} The converted property descriptor
 * @see ECMA-262 Spec Chapter 8.10.4
 */
exports.fromPropertyDescriptor = fromPropertyDescriptor;
function fromPropertyDescriptor(desc) {

	var obj = new ObjectType();

	if (!desc) {
		return new UndefinedType();
	}

	if (isDataDescriptor(desc)) {

		obj.defineOwnProperty('value', {
			value: desc.value || new UndefinedType(),
			writable: true,
			enumerable: true,
			configurable: true
		}, false, true);

		obj.defineOwnProperty('writable', {
			value: new BooleanType(desc.writable),
			writable: true,
			enumerable: true,
			configurable: true
		}, false, true);

	} else {

		obj.defineOwnProperty('get', {
			value: desc.get || new UndefinedType(),
			writable: true,
			enumerable: true,
			configurable: true
		}, false, true);

		obj.defineOwnProperty('set', {
			value: desc.set || new UndefinedType(),
			writable: true,
			enumerable: true,
			configurable: true
		}, false, true);
	}

	obj.defineOwnProperty('configurable', {
		value: new BooleanType(desc.configurable),
		writable: true,
		enumerable: true,
		configurable: true
	}, false, true);

	obj.defineOwnProperty('enumerable', {
		value: new BooleanType(desc.enumerable),
		writable: true,
		enumerable: true,
		configurable: true
	}, false, true);

	return obj;
}

/**
 * Converts a generic object to a property descriptor (think Object.defineProperty).
 *
 * @method module:base/conversion.toPropertyDescriptor
 * @param {Object} o The object to convert
 * @return {(module:base/types/object.DataPropertyDescriptor | module:base/types/object.AccessorPropertyDescriptor)} The converted property descriptor
 * @see ECMA-262 Spec Chapter 8.10.5
 */
exports.toPropertyDescriptor = toPropertyDescriptor;
function toPropertyDescriptor(obj) {
	var desc = {},
		getter,
		setter;

	if (type(obj) === 'Unknown') {

		// Create a sensible default data property descriptor
		desc.value = obj;
		desc.writable = false;
		desc.enumerable = true;
		desc.configurable = false;

	} else if (type(obj) === 'Object') {

		// Parse through all of the options
		if (obj.hasProperty('enumerable')) {
			desc.enumerable = toBoolean(obj.get('enumerable')).value;
		}
		if (obj.hasProperty('configurable')) {
			desc.configurable = toBoolean(obj.get('configurable')).value;
		}
		if (obj.hasProperty('value')) {
			desc.value = obj.get('value');
		}
		if (obj.hasProperty('writable')) {
			desc.writable = toBoolean(obj.get('writable')).value;
		}
		if (obj.hasProperty('get')) {
			getter = obj.get('get');
			if (type(getter) !== 'Undefined' && type(getter) !== 'Unknown' && !isCallable(getter)) {
				throwNativeException('TypeError', 'get is not callable');
			}
			desc.get = getter;
		}
		if (obj.hasProperty('set')) {
			setter = obj.get('set');
			if (type(setter) !== 'Undefined' && type(setter) !== 'Unknown' && !isCallable(setter)) {
				throwNativeException('TypeError', 'set is not callable');
			}
			desc.set = setter;
		}
		if ((desc.get || desc.set) && (typeof desc.value != 'undefined' || typeof desc.writable != 'undefined')) {
			throwNativeException('TypeError', 'Property descriptors cannot contain both get/set and value/writable properties');
		}
	} else {
		throwNativeException('TypeError', 'Property descriptors must be objects');
	}

	return desc;
}

/**
 * ECMA-262 Spec: <em>The abstract operation CheckObjectCoercible throws an error if its argument is a value that cannot
 * be converted to an Object using ToObject.</em>
 *
 * @method module:base/conversion.checkObjectCoercible
 * @param {module:base.BaseType} input The value to check if it's coercible
 * @see ECMA-262 Spec Chapter 9.10
 */
exports.checkObjectCoercible = checkObjectCoercible;
function checkObjectCoercible(input) {
	if (isType(input, ['Undefined', 'Null'])) {
		throwNativeException('TypeError', type(input).toLowerCase() + ' cannot be coerced to an object');
	}
}

/**
 * ECMA-262 Spec: <em>The abstract operation IsCallable determines if its argument, which must be an ECMAScript
 * language value, is a callable function Object</em>
 *
 * @method module:base/conversion.isCallable
 * @param {module:base.BaseType} input The value to check if it's callable
 * @return {boolean} Whether or not the object is callable
 * @see ECMA-262 Spec Chapter 9.11
 */
exports.isCallable = isCallable;
function isCallable(input) {
	if (input && type(input) === 'Object') {
		return !!input.callFunction;
	} else {
		return false;
	}
}

/**
 * Converts a value to unknown "in-place"
 *
 * @method module:base/conversion.convertToUnknown
 * @param {module:base.BaseType} value The value to convert
 */
exports.convertToUnknown = convertToUnknown;
function convertToUnknown (value) {
	UnknownType.call(value);
}

/**
 * The Strict Equality Comparison Algorithm
 *
 * @method module:base/conversion.strictEquals
 * @param {module:base.BaseType} x The first value to compare
 * @param {module:base.BaseType} y The second value to compare
 * @return {boolean} Whether or not the two equals are strictly equal
 * @see ECMA-262 Spec Chapter 11.9.6
 */
exports.strictEquals = strictEquals;
function strictEquals(x, y) {
	var typeX = type(x),
		typeY = type(y);

	if (typeX !== typeY) {
		return false;
	}

	switch(typeX) {
		case 'Undefined':
		case 'Null': return true;
		case 'Boolean':
		case 'Number':
		case 'String': return x.value === y.value;
		case 'Object': return x === y;
	}
}

/**
 * The Abstract Equality Comparison Algorithm
 *
 * @method module:base/conversion.strictEquals
 * @param {module:base.BaseType} x The first value to compare
 * @param {module:base.BaseType} y The second value to compare
 * @return {boolean} Whether or not the two equals are strictly equal
 * @see ECMA-262 Spec Chapter 11.9.3
 */
exports.abstractEquality = abstractEquality;
function abstractEquality(x, y) {
	var typeX = type(x),
		typeY = type(y),
		xValue = x.value,
		yValue = y.value;

	// Step 1
	if (typeY === typeX) {
		if (typeX === 'Undefined' || typeX === 'Null') {
			return true;
		}
		if (typeX === 'Number') {
			if (isNaN(xValue) || isNaN(yValue)) {
				return false;
			}
			return xValue === yValue;
		}
		if (typeX === 'String') {
			return xValue === yValue;
		}
		if (typeX === 'Boolean') {
			return xValue === yValue;
		}
		return x === y;
	}

	// Step 2
	if (typeX === 'Undefined' && typeY === 'Null') {
		return true;
	}

	// Step 3
	if (typeX === 'Null' && typeY === 'Undefined') {
		return true;
	}

	// Step 4
	if (typeX === 'Number' && typeY === 'String') {
		return abstractEquality(x, toNumber(y));
	}

	// Step 5
	if (typeX === 'String' && typeY === 'Number') {
		return abstractEquality(toNumber(x), y);
	}

	// Step 6
	if (typeX === 'Boolean') {
		return abstractEquality(toNumber(x), y);
	}

	// Step 7
	if (typeY === 'Boolean') {
		return abstractEquality(x, toNumber(y));
	}

	// Step 8
	if (typeY === 'Object' && (typeX === 'String' || typeX === 'Number')) {
		return abstractEquality(x, toPrimitive(y));
	}

	// Step 8
	if (typeX === 'Object' && (typeY === 'String' || typeY === 'Number')) {
		return abstractEquality(toPrimitive(x), y);
	}

	// Step 9
	return false;
}

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * All classes and helper functions for context
 *
 * @module base/context
 */
/*global
Runtime,
RuleProcessor,
AST,
UnknownType,
UndefinedType,
handleRecoverableNativeException,
type,
ReferenceType,
ObjectType,
FunctionType,
DataPropertyDescriptor,
isAccessorDescriptor,
throwNativeException,
NumberType,
throwTypeError,
toObject
*/

/*****************************************
 *
 * Lexical Environments and Contexts
 *
 *****************************************/

var globalObject,
	contextStack = [],
	functionContextCount = 0,
	tryCatch = 0,
	skippedModeCounter = 0;

// ******** DeclarativeEnvironmentRecord Class ********

function bindingExists (bindings, name) {
	return Object.prototype.hasOwnProperty.call(bindings, name);
}

/**
 * @classdesc ECMA-262 Spec: <em>Declarative environment records are used to define the effect of ECMAScript language
 * syntactic elements such as FunctionDeclarations, VariableDeclarations, and Catch clauses that directly associate
 * identifier bindings with ECMAScript language values. Each declarative environment record is associated with an
 * ECMAScript program scope containing variable and/or function declarations. A declarative environment record binds the
 * set of identifiers defined by the declarations contained within its scope.</em>
 *
 * @constructor module:base/context.DeclarativeEnvironmentRecord
 * @see ECMA-262 Spec Chapter 10.2.1
 */
exports.DeclarativeEnvironmentRecord = DeclarativeEnvironmentRecord;
function DeclarativeEnvironmentRecord() {
	this._bindings = {};
	this._ambiguousContext = false;
	this._skippedModeStack = [];
}

/**
 * ECMA-262 Spec: <em>The concrete environment record method HasBinding for declarative environment records simply
 * determines if the argument identifier is one of the identifiers bound by the record</em>
 *
 * @method module:base.DeclarativeEnvironmentRecord#hasBinding
 * @param {string} n The name of the binding
 * @return {boolean} Whether or not this environment record has the binding
 * @see ECMA-262 Spec Chapter 10.2.1.1.1
 */
DeclarativeEnvironmentRecord.prototype.hasBinding = function hasBinding(n) {
	return bindingExists(this._bindings, n);
};

/**
 * ECMA-262 Spec: <em>The concrete Environment Record method CreateMutableBinding for declarative environment records
 * creates a new mutable binding for the name n that is initialised to the value undefined. A binding must not already
 * exist in this Environment Record for n. If Boolean argument d is provided and has the value true the new binding is
 * marked as being subject to deletion.</em>
 *
 * @method module:base/context.DeclarativeEnvironmentRecord#createMutableBinding
 * @param {string} n The name of the binding
 * @param {boolean} d Whether or not the binding can be deleted
 * @throws Thrown if the binding already exists
 * @see ECMA-262 Spec Chapter 10.2.1.1.2
 */
DeclarativeEnvironmentRecord.prototype.createMutableBinding = function createMutableBinding(n, d) {
	var bindings = this._bindings;
	if (bindingExists(bindings, n)) {
		throw new Error('Could not create mutable binding: binding "' + n + '" already exists');
	}

	bindings[n] = {
		value: new UndefinedType(),
		alternateValues: {},
		isDeletable: !!d,
		isMutable: true
	};
};

/**
 * ECMA-262 Spec: <em>The concrete Environment Record method SetMutableBinding for declarative environment records
 * attempts to change the bound value of the current binding of the identifier whose name is the value of the argument
 * N to the value of argument v. A binding for n must already exist. If the binding is an immutable binding, a TypeError
 * is thrown if s is true.</em>
 *
 * @method module:base/context.DeclarativeEnvironmentRecord#setMutableBinding
 * @param {string} n The name of the binding
 * @param {module:base.BaseType} v The value to set on the binding
 * @param {boolean} s Indicates strict mode, i.e. whether or not an error should be thrown if the binding is not mutable
 * @throws Thrown if the binding does not exist
 * @see ECMA-262 Spec Chapter 10.2.1.1.3
 */
DeclarativeEnvironmentRecord.prototype.setMutableBinding = function setMutableBinding(n, v, s) {
	var bindings = this._bindings;
	if (!bindingExists(bindings, n)) {
		throw new Error('Could not set mutable binding: binding "' + n + '" does not exist');
	}

	if (!bindings[n].isMutable) {
		if (s) {
			handleRecoverableNativeException('TypeError', 'Could not set binding: binding "' + n + '" is not mutable');
			bindings[n].value = new UnknownType();
		} else {
			return;
		}
	}

	if (isLocalSkippedMode() || !this.getBindingValue(n)._isSkippedLocal()) {
		if (type(v) === 'Unknown' || !this.getBindingValue(n)._isLocal() || isAmbiguousBlock()) {
			bindings[n].alternateValues[getSkippedSection()] = new UnknownType();
		} else {
			bindings[n].alternateValues[getSkippedSection()] = v;
		}
	} else {
		if (type(v) === 'Unknown' || !this.getBindingValue(n)._isLocal() || isAmbiguousBlock()) {
			bindings[n].value = new UnknownType();
		} else {
			bindings[n].value = v;
		}
	}
};

/**
 * ECMA-262 Spec: <em>The concrete Environment Record method GetBindingValue for declarative environment records simply
 * returns the value of its bound identifier whose name is the value of the argument n. The binding must already exist.
 * If s is true and the binding is an uninitialised immutable binding throw a ReferenceError exception.</em>
 *
 * @method module:base/context.DeclarativeEnvironmentRecord#getBindingValue
 * @param {string} n The name of the binding
 * @param {boolean} s Indicates strict mode, i.e. whether or not an error should be thrown if the binding has not been
 *		initialized
 *	@param {boolean} alternate Whether or not to get the alternate or standard value(s)
 * @return {module:base.BaseType} The value of the binding
 * @throws Thrown if the binding does not exist
 * @see ECMA-262 Spec Chapter 10.2.1.1.4
 */
DeclarativeEnvironmentRecord.prototype.getBindingValue = function getBindingValue(n, s, alternate) {

	var binding = this._bindings[n];
	if (!bindingExists(this._bindings, n)) {
		throw new Error('Could not get value: binding "' + n + '" does not exist');
	}

	if (s && !binding.isMutable && !binding.isInitialized) {
		handleRecoverableNativeException('ReferenceError', 'Could not get value: binding "' + n + '" has not been initialized');
		return alternate ? { 1: new UnknownType() } : new UnknownType();
	}

	return alternate ? binding.alternateValues : binding.value;
};

/**
 * ECMA-262 Spec: <em>The concrete Environment Record method DeleteBinding for declarative environment records can only
 * delete bindings that have been explicitly designated as being subject to deletion.</em>
 *
 * @method module:base/context.DeclarativeEnvironmentRecord#deleteBinding
 * @param {string} n The name of the binding
 * @return {boolean} Whether or not the binding has been deleted
 * @see ECMA-262 Spec Chapter 10.2.1.1.5
 */
DeclarativeEnvironmentRecord.prototype.deleteBinding = function deleteBinding(n) {

	var binding = this._bindings[n];
	if (!binding) {
		return true;
	}

	if (!binding.isDeletable) {
		return false;
	}

	delete this._bindings[n];
	return true;
};

/**
 * ECMA-262 Spec: <em>Declarative Environment Records always return undefined as their ImplicitThisValue.</em>
 *
 * @method module:base/context.DeclarativeEnvironmentRecord#implicitThisValue
 * @return {module:base/types/undefined.UndefinedType} Always undefined
 * @see ECMA-262 Spec Chapter 10.2.1.1.6
 */
DeclarativeEnvironmentRecord.prototype.implicitThisValue = function implicitThisValue() {
	return new UndefinedType(); // Always return undefined for declarative environments
};

/**
 * ECMA-262 Spec: <em>The concrete Environment Record method CreateImmutableBinding for declarative environment records
 * creates a new immutable binding for the name n that is initialised to the value undefined. A binding must not already
 * exist in this environment record for n.</em>
 *
 * @method module:base/context.DeclarativeEnvironmentRecord#createImmutableBinding
 * @param {string} n The name of the binding
 * @throws Thrown if the binding already exists
 * @see ECMA-262 Spec Chapter 10.2.1.1.7
 */
DeclarativeEnvironmentRecord.prototype.createImmutableBinding = function createImmutableBinding(n) {

	var bindings = this._bindings;
	if (bindingExists(bindings, n)) {
		throw new Error('Could not create immutable binding: binding "' + n + '" already exists');
	}

	bindings[n] = {
		value: new UndefinedType(),
		alternateValues: {},
		isDeletable: false,
		isMutable: false,
		isInitialized: false
	};
};

/**
 * ECMA-262 Spec: <em>The concrete Environment Record method InitializeImmutableBinding for declarative environment
 * records is used to set the bound value of the current binding of the identifier whose name is the value of the
 * argument n to the value of argument v. An uninitialised immutable binding for n must already exist.</em>
 *
 * @method module:base/context.DeclarativeEnvironmentRecord#initializeImmutableBinding
 * @param {string} n The name of the binding
 * @param {module:base.BaseType} v The value to initialize the binding to
 * @throws Thrown if the binding does not exist
 * @throws Thrown if the binding is not immutable or has already been initialized
 * @see ECMA-262 Spec Chapter 10.2.1.1.8
 */
DeclarativeEnvironmentRecord.prototype.initializeImmutableBinding = function initializeImmutableBinding(n, v) {

	var binding = this._bindings[n];
	if (!binding) {
		throw new Error('Could not initialize immutable value: binding "' + n + '" does not exist');
	}

	if (binding.isInitialized !== false) {
		throw new Error('Could not initialize immutable value: binding "' + n + '" has either been initialized already or is not an immutable value');
	}

	binding.value = v;
	binding.isInitialized = true;
};

// ******** ObjectEnvironmentRecord Class ********

/**
 * @classdesc ECMA-262 Spec: <em>Object environment records are used to define the effect of ECMAScript elements such as
 * Program and WithStatement that associate identifier bindings with the properties of some object. Each object
 * environment record is associated with an object called its binding object. An object environment record binds
 * the set of identifier names that directly correspond to the property names of its binding object. Property names
 * that are not an IdentifierName are not included in the set of bound identifiers. Both own and inherited properties
 * are included in the set regardless of the setting of their [[enumerable]] attribute. Because properties can be
 * dynamically added and deleted from objects, the set of identifiers bound by an object environment record may
 * potentially change as a side-effect of any operation that adds or deletes properties. Any bindings that are created
 * as a result of such a side-effect are considered to be a mutable binding even if the writable attribute of the
 * corresponding property has the value false. Immutable bindings do not exist for object environment records.</em>
 *
 * @constructor module:base/context.ObjectEnvironmentRecord
 * @param {module:base.BaseType} bindingObject The object to bind the environment record to
 * @see ECMA-262 Spec Chapter 10.2.1
 */
exports.ObjectEnvironmentRecord = ObjectEnvironmentRecord;
function ObjectEnvironmentRecord(bindingObject) {
	if (!bindingObject) {
		throw '';
	}
	this._bindingObject = bindingObject;
	this._ambiguousContext = false;
	this._skippedModeStack = [];
}

/**
 * ECMA-262 Spec: <em>The concrete Environment Record method HasBinding for object environment records determines if its
 * associated binding object has a property whose name is the value of the argument n</em>
 *
 * @method module:base/context.ObjectEnvironmentRecord#hasBinding
 * @param {string} n The name of the binding
 * @return {boolean} Whether or not this environment record has the binding
 * @see ECMA-262 Spec Chapter 10.2.1.2.1
 */
ObjectEnvironmentRecord.prototype.hasBinding = function hasBinding(n) {
	return this._bindingObject.hasProperty(n);
};

/**
 * ECMA-262 Spec: <em>The concrete Environment Record method CreateMutableBinding for object environment records creates
 * in an environment record‘s associated binding object a property whose name is the String value and initialises it to
 * the value undefined. A property named n must not already exist in the binding object. If Boolean argument d is
 * provided and has the value true the new property‘s [[configurable]] attribute is set to true, otherwise it is set to
 * false.</em>
 *
 * @method module:base/context.ObjectEnvironmentRecord#createMutableBinding
 * @param {string} n The name of the binding
 * @param {boolean} d Whether or not the binding can be deleted
 * @param {boolean} suppressEvent Suppresses the 'propertySet' event (used when setting prototypes)
 * @throws Thrown if the binding already exists
 * @see ECMA-262 Spec Chapter 10.2.1.2.2
 */
ObjectEnvironmentRecord.prototype.createMutableBinding = function createMutableBinding(n, d, suppressEvent) {
	var bindingObject = this._bindingObject;
	if (bindingObject.hasProperty(n)) {
		throw new Error('Internal Error: could not create mutable binding: binding "' + n + '" already exists');
	}

	bindingObject.defineOwnProperty(n, {
		value: new UndefinedType(),
		writable: true,
		enumerable: true,
		configurable: !!d
	}, true, suppressEvent);
};

/**
 * ECMA-262 Spec: <em>The concrete Environment Record method SetMutableBinding for object environment records attempts
 * to set the value of the environment record‘s associated binding object‘s property whose name is the value of the
 * argument n to the value of argument V. A property named N should already exist but if it does not or is not currently
 * writable, error handling is determined by the value of the Boolean argument s.</em>
 *
 * @method module:base/context.ObjectEnvironmentRecord#setMutableBinding
 * @param {string} n The name of the binding
 * @param {module:base.BaseType} v The value to set on the binding
 * @param {boolean} s Indicates strict mode, i.e. whether or not an error should be thrown if the binding is not mutable
 * @param {boolean} suppressEvent Suppresses the 'propertySet' event (used when setting prototypes)
 * @see ECMA-262 Spec Chapter 10.2.1.2.3
 */
ObjectEnvironmentRecord.prototype.setMutableBinding = function setMutableBinding(n, v, s, suppressEvent) {
	this._bindingObject.put(n, v, s, suppressEvent);
};

/**
 * ECMA-262 Spec: <em>The concrete Environment Record method SetMutableBinding for object environment records attempts
 * to set the value of the environment record‘s associated binding object‘s property whose name is the value of the
 * argument n to the value of argument v. A property named N should already exist but if it does not or is not currently
 * writable, error handling is determined by the value of the Boolean argument s.</em>
 *
 * @method module:base/context.ObjectEnvironmentRecord#getBindingValue
 * @param {string} n The name of the binding
 * @param {boolean} s Indicates strict mode, i.e. whether or not an error should be thrown if the binding has not been
 *		initialized
 * @param {boolean} alternate Whether or not to get the alternate or standard value(s)
 * @return {module:base.BaseType} The value of the binding
 * @see ECMA-262 Spec Chapter 10.2.1.2.4
 */
ObjectEnvironmentRecord.prototype.getBindingValue = function getBindingValue(n, s, alternate) {
	var bindingObject = this._bindingObject;
	if (!bindingObject.hasProperty(n)) {
		if (s) {
			handleRecoverableNativeException('ReferenceError', 'Property ' + n + ' does not exist');
			return new UnknownType();
		}
		return new UndefinedType();
	}

	return bindingObject.get(n, alternate);
};

/**
 * ECMA-262 Spec: <em>The concrete Environment Record method DeleteBinding for object environment records can only
 * delete bindings that correspond to properties of the environment object whose [[configurable]] attribute have the
 * value true.</em>
 *
 * @method module:base/context.ObjectEnvironmentRecord#deleteBinding
 * @param {string} n The name of the binding
 * @return {boolean} Whether or not the binding has been deleted
 * @see ECMA-262 Spec Chapter 10.2.1.2.5
 */
ObjectEnvironmentRecord.prototype.deleteBinding = function deleteBinding(n) {
	return this._bindingObject['delete'](n, false);
};

/**
 * ECMA-262 Spec: <em>Object Environment Records return undefined as their ImplicitThisValue unless their provideThis
 * flag is true.</em>
 *
 * @method module:base/context.ObjectEnvironmentRecord#implicitThisValue
 * @return {module:base.BaseType} The value of this, if it exists
 * @see ECMA-262 Spec Chapter 10.2.1.2.6
 */
ObjectEnvironmentRecord.prototype.implicitThisValue = function implicitThisValue() {
	if (this.provideThis) {
		return this._bindingObject;
	} else {
		return new UndefinedType();
	}
};

// ******** Lexical Environment ********

/**
 * @classdesc ECMA-262 Spec: <em>A Lexical Environment is a specification type used to define the association of
 * Identifiers to specific variables and functions based upon the lexical nesting structure of ECMAScript code. A
 * Lexical Environment consists of an Environment Record and a possibly null reference to an outer Lexical Environment.
 * Usually a Lexical Environment is associated with some specific syntactic structure of ECMAScript code such as a
 * FunctionDeclaration, a WithStatement, or a Catch clause of a TryStatement and a new Lexical Environment is created
 * each time such code is evaluated.</em>
 *
 * @constructor module:base/context~LexicalEnvironment
 * @param {(module:base/context.DeclarativeEnvironmentRecord | module:base/context.ObjectEnvironmentRecord)} envRec The environment record
 *		to associate with the new lexical environment
 * @param {module:base/context~LexicalEnvironment} [outer] The outer lexical environment
 * @property {module:base/context.DeclarativeEnvironmentRecord|module:base/context.ObjectEnvironmentRecord} envRec The environment
 *		record associated with this lexical environment
 * @property {(module:base/context~LexicalEnvironment | undefined)} outer The outer lexical environment of this lexical environment,
 *		if it exists
 * @see ECMA-262 Spec Chapter 10.2
 */
function LexicalEnvironment(envRec, outer) {
	this.envRec = envRec;
	this.outer = outer;
}

// ******** Lexical Environment Operations ********

/**
 * ECMA-262 Spec: <em>The abstract operation GetIdentifierReference is called with a Lexical Environment lex, an
 * identifier String name, and a Boolean flag strict. The value of lex may be null.</em>
 *
 * @method module:base/context.getIdentifierReference
 * @param {(module:base/context~LexicalEnvironment | undefined)} lex The lexical environment to search
 * @param {string} name The name of the identifier
 * @param {boolean} strict Whether or not to fetch the identifier in strict mode
 * @see ECMA-262 Spec Chapter 10.2.2.1
 */
exports.getIdentifierReference = getIdentifierReference;
function getIdentifierReference(lex, name, strict) {
	var newRef;
	if (!lex) {
		newRef = new ReferenceType();
		newRef.baseValue = new UndefinedType();
		newRef.referencedName = name;
		newRef.strictReference = strict;
		return newRef;
	}
	if (lex.envRec.hasBinding(name)) {
		newRef = new ReferenceType();
		newRef.baseValue = lex.envRec;
		newRef.referencedName = name;
		newRef.strictReference = strict;
		return newRef;
	} else {
		return getIdentifierReference(lex.outer, name, strict);
	}
}

/**
 * Creates a new lexical environment with a declarative environment record
 *
 * @method module:base/context.newDeclarativeEnvironment
 * @param {(module:base/context~LexicalEnvironment | undefined)} e The outer lexical environment of the new lexical environment
 * @return {module:base/context~LexicalEnvironment} The newly created lexical environment
 * @see ECMA-262 Spec Chapter 10.2.2.2
 */
exports.newDeclarativeEnvironment = newDeclarativeEnvironment;
function newDeclarativeEnvironment(e) {
	return new LexicalEnvironment(new DeclarativeEnvironmentRecord(), e);
}

/**
 * Creates a new lexical environment with an object environment record
 *
 * @method module:base/context.newObjectEnvironment
 * @param {module:base/types/object.ObjectType} o The binding object
 * @param {(module:base/context~LexicalEnvironment | undefined)} e The outer lexical environment of the new lexical environment
 * @return {module:base/context~LexicalEnvironment} The newly created lexical environment
 * @see ECMA-262 Spec Chapter 10.2.2.3
 */
exports.newObjectEnvironment = newObjectEnvironment;
function newObjectEnvironment(o, e) {
	return new LexicalEnvironment(new ObjectEnvironmentRecord(o), e);
}

// ******** Execution Context ********

/**
 * @classdesc ECMA-262 Spec: <em>When control is transferred to ECMAScript executable code, control is entering an
 * execution context. Active execution contexts logically form a stack. The top execution context on this logical stack
 * is the running execution context. A new execution context is created whenever control is transferred from the
 * executable code associated with the currently running execution context to executable code that is not associated
 * with that execution context. The newly created execution context is pushed onto the stack and becomes the running
 * execution context. An execution context contains whatever state is necessary to track the execution progress of its
 * associated code.</em>
 *
 * @constructor module:base/context~ExecutionContext
 * @param {module:base/context~LexicalEnvironment} lexicalEnvironment ECMA-262 Spec: <em>Identifies the Lexical Environment
 *		used to resolve identifier references made by code within this execution context.</em>
 * @param {module:base/context~LexicalEnvironment} variableEnvironment ECMA-262 Spec: <em>Identifies the Lexical Environment
 *		whose environment record holds bindings created by VariableStatements and FunctionDeclarations within this
 *		execution context.</em>
 * @param {module:base/types/object.ObjectType} thisBinding ECMA-262 Spec: <em>The value associated with the this keyword within
 *		ECMAScript code associated with this execution context.</em>
 * @param {boolean} strict Indicates whether or not this execution context is strict mode
 * @property {module:base/context~LexicalEnvironment} lexicalEnvironment ECMA-262 Spec: <em>Identifies the Lexical Environment
 *		used to resolve identifier references made by code within this execution context.</em>
 * @property {module:base/context~LexicalEnvironment} variableEnvironment ECMA-262 Spec: <em>Identifies the Lexical Environment
 *		whose environment record holds bindings created by VariableStatements and FunctionDeclarations within this
 *		execution context.</em>
 * @property {module:base/types/object.ObjectType} thisBinding ECMA-262 Spec: <em>The value associated with the this keyword within
 *		ECMAScript code associated with this execution context.</em>
 * @property {boolean} strict Indicates whether or not this execution context is strict mode
 */
function ExecutionContext(lexicalEnvironment, variableEnvironment, thisBinding, strict) {
	this.lexicalEnvironment = lexicalEnvironment;
	this.variableEnvironment = variableEnvironment;
	this.thisBinding = thisBinding;
	this.strict = typeof strict != 'undefined' ? strict : false;
	this._ambiguousBlock = 0;
}

// ******** Context Creation Methods ********

/**
 * @private
 */
function findDeclarations(ast, context) {
	var functions = [],
		variables = [];

	AST.walk(ast, [
		{
			nodeType: 'AST_Defun',
			callback: function(node) {
				var formalParameterList = [],
					i, len;
				for (i = 0, len = node.argnames.length; i < len; i++) {
					formalParameterList.push(node.argnames[i].name);
				}
				node._lastKnownContext = context;
				functions.push(node);
				Runtime.addFunction(node);
				return true;
			}
		},
		{
			nodeType: 'AST_Var',
			callback: function(node) {
				var i, len;
				for (i = 0, len = node.definitions.length; i < len; i++) {
					variables.push({
						variableName: node.definitions[i].name.name
					});
					if (node.definitions[i].value && node.definitions[i].value.className === 'AST_Function') {
						node.definitions[i].value._lastKnownContext = context;
						Runtime.addFunction(node.definitions[i].value);
					}
				}
				return true;
			}
		},
		{
			nodeType: 'AST_Const',
			callback: function(node) {
				var i, len;
				for (i = 0, len = node.definitions.length; i < len; i++) {
					variables.push({
						variableName: node.definitions[i].name.name
					});
				}
				return true;
			}
		},
		{
			nodeType: 'AST_Function',
			callback: function(node) {
				node._lastKnownContext = context;
				Runtime.addFunction(node);
				return true;
			}
		}
	]);

	return {
		functions: functions,
		variables: variables
	};
}

/**
 * @private
 */
function processFunctionDefinition(node) {

	var identifier = node.name.name,
		formalParameterList = [],
		context = getCurrentContext(),
		strict = context.strict || RuleProcessor.isBlockStrict(node),
		functionObject,
		i,
		len;

	RuleProcessor.fireRuleEvent(node, {}, false);
	RuleProcessor.logRule('AST_Defun', identifier);

	setVisited(node.name);

	for (i = 0, len = node.argnames.length; i < len; i++) {
		setVisited(node.argnames[i]);
		formalParameterList.push(node.argnames[i].name);
	}

	try {
		if (strict) {
			if (identifier === 'eval' || identifier === 'arguments') {
				handleRecoverableNativeException('SyntaxError', identifier + ' is not a valid identifier name');
				throw 'Unknown';
			}
			for (i = 0, len = formalParameterList.length; i < len; i++) {
				if (formalParameterList[i] === 'eval' || formalParameterList[i] === 'arguments') {
					handleRecoverableNativeException('SyntaxError', formalParameterList[i] + ' is not a valid identifier name');
					throw 'Unknown';
				}
				if (formalParameterList.indexOf(formalParameterList[i], i + 1) !== -1) {
					handleRecoverableNativeException('SyntaxError', 'Duplicate parameter names are not allowed in strict mode');
					throw 'Unknown';
				}
			}
		}

		functionObject = new FunctionType(formalParameterList, node, context.lexicalEnvironment, strict);
		functionObject._location = {
			filename: node.start.file,
			line: node.start.line,
			column: node.start.column
		};
		functionObject._ast = node;
	} catch(e) {
		if (e === 'Unknown') {
			functionObject = new UnknownType();
		} else {
			throw e;
		}
	}

	RuleProcessor.fireRuleEvent(node, {
		identifier: identifier,
		formalParameterList: formalParameterList,
		strict: strict,
		functionObject: functionObject
	}, true);

	return functionObject;
}

/**
 * Creates the global context
 *
 * @method module:base/context.createGlobalContext
 * @param {boolean} strict Indicates whether or not this execution context is strict mode
 * @return {module:base/context~ExecutionContext} The new global execution context
 * @see ECMA-262 Spec Chapter 10.4.1 and Chapter 10.5
 */
exports.createGlobalContext = createGlobalContext;
function createGlobalContext(strict) {

	// Create the context
	globalObject = new ObjectType();
	var env = newObjectEnvironment(globalObject),
		executionContext = new ExecutionContext(
			env,
			env,
			globalObject,
			strict);
	globalObject._closure = globalObject;
	enterContext(executionContext);

	// Return the context
	return executionContext;
}

/**
 * Initializes the global context with its AST. This must happen AFTER Base.init() is called
 *
 * @method module:base/context.initGlobalAST
 * @param {module:AST.node} ast The AST associated with this global context
 */
exports.initGlobalAST = initGlobalAST;
function initGlobalAST(ast) {
	var globalContext = getGlobalContext(),
		result = findDeclarations(ast, globalContext),
		functions = result.functions,
		variables = result.variables,
		env = globalContext.variableEnvironment.envRec,
		strict = RuleProcessor.isBlockStrict(ast),
		i, len,
		fn,
		fo,
		funcAlreadyDeclared,
		configurableBindings = false,
		existingProp,
		descriptor,
		dn,
		varAlreadyDeclared;

	// Find all of the function declarations and bind them
	for (i = 0, len = functions.length; i < len; i++) {
		fn = functions[i].name.name;
		fo = functions[i]._funcObject = processFunctionDefinition(functions[i]);
		funcAlreadyDeclared = env.hasBinding(fn);

		if (!funcAlreadyDeclared) {
			env.createMutableBinding(fn, configurableBindings);
		} else if (env === getGlobalContext().variableEnvironment.envRec) {
			existingProp = globalObject.getProperty(fn);
			if (existingProp.configurable) {
				descriptor = new DataPropertyDescriptor();
				descriptor.writable = true;
				descriptor.enumerable = true;
				descriptor.configurable = configurableBindings;
				globalObject.defineOwnProperty(fn, descriptor, true);
			} else if (isAccessorDescriptor(existingProp) || (existingProp.writable !== true &&
					existingProp.enumerable !== true)) {
				throwNativeException('TypeError', fn +
					' is not a valid identifier name because a non-writable identifier with that name already exists');
			}
		}

		env.setMutableBinding(fn, fo, strict);
	}

	// Find all of the variable declarations and bind them
	for (i = 0, len = variables.length; i < len; i++) {
		dn = variables[i].variableName,
		varAlreadyDeclared = env.hasBinding(dn);

		if (!varAlreadyDeclared) {
			env.createMutableBinding(dn, configurableBindings);
			env.setMutableBinding(dn, new UndefinedType(), strict);
		}
	}
}

/**
 * Creates a module context
 *
 * @method module:base/context.createGlobalContext
 * @param {module:AST.node} ast The AST associated with this global context
 * @param {boolean} strict Indicates whether or not this execution context is strict mode
 * @param {boolean} createExports Whether or not to create a module.exports object in this context
 * @param {boolean} ambiguous Whether or not this is an ambiguous context
 * @return {module:base/context~ExecutionContext} The new global execution context
 * @see ECMA-262 Spec Chapter 10.4.1 and Chapter 10.5
 */
exports.createModuleContext = createModuleContext;
function createModuleContext(ast, strict, createExports, ambiguous) {

	// Create the context
	var moduleObject = new ObjectType(),
		env = newObjectEnvironment(moduleObject, getGlobalContext().variableEnvironment),
		configurableBindings = false,
		executionContext = new ExecutionContext(
			env,
			env,
			moduleObject,
			strict),
		len, i,
		functions, variables, result,
		fn, fo,
		funcAlreadyDeclared,
		existingProp,
		descriptor,
		dn,
		varAlreadyDeclared,
		exportsObject;
	env.envRec._ambiguousContext = !!ambiguous;
	enterContext(executionContext);
	env = executionContext.variableEnvironment.envRec;

	result = findDeclarations(ast, executionContext);
	functions = result.functions;
	variables = result.variables;

	if (createExports) {
		exportsObject = new ObjectType(),
		moduleObject.put('exports', exportsObject, false);
		env.createMutableBinding('module', true);
		env.setMutableBinding('module', moduleObject);
	}

	// Find all of the function declarations and bind them
	for (i = 0, len = functions.length; i < len; i++) {
		fn = functions[i].name.name;
		fo = functions[i]._funcObject = processFunctionDefinition(functions[i]);
		funcAlreadyDeclared = env.hasBinding(fn);

		if (!funcAlreadyDeclared) {
			env.createMutableBinding(fn, configurableBindings);
		} else if (env === getGlobalContext().variableEnvironment.envRec) {
			existingProp = moduleObject.getProperty(fn);
			if (existingProp.configurable) {
				descriptor = new DataPropertyDescriptor();
				descriptor.writable = true;
				descriptor.enumerable = true;
				descriptor.configurable = configurableBindings;
				moduleObject.defineOwnProperty(fn, descriptor, true);
			} else if (isAccessorDescriptor(existingProp) || (existingProp.writable !== true &&
					existingProp.enumerable !== true)) {
				throwNativeException('TypeError', fn +
					' is not a valid identifier name because a non-writable identifier with that name already exists');
			}
		}

		env.setMutableBinding(fn, fo, strict);
	}

	// Find all of the variable declarations and bind them
	for (i = 0, len = variables.length; i < len; i++) {
		dn = variables[i].variableName,
		varAlreadyDeclared = env.hasBinding(dn);

		if (!varAlreadyDeclared) {
			env.createMutableBinding(dn, configurableBindings);
			env.setMutableBinding(dn, new UndefinedType(), strict);
		}
	}

	// Return the context
	return executionContext;
}

/**
 * Creates an eval context
 *
 * @method module:base/context.createEvalContext
 * @param {(module:base/context~ExecutionContext | undefined)} callingContext The context that is evaling code
 * @param {module:AST.node} code The code associated with this eval context
 * @param {boolean} strict Whether or not this context is a strict mode context
 * @return {module:base/context~ExecutionContext} The new eval execution context
 * @see ECMA-262 Spec Chapter 10.4.2 and Chapter 10.5
 */
exports.createEvalContext = createEvalContext;
function createEvalContext(callingContext, code, strict, isDirectEval) {

	var executionContext,
		env,
		configurableBindings = true,
		len, i,
		result,
		functions,
		variables,
		fn,
		fo,
		funcAlreadyDeclared,
		existingProp,
		descriptor,
		dn,
		varAlreadyDeclared;

	// Create or set the execution context
	if (!callingContext || !isDirectEval) {
		callingContext = getModuleContext();
	}
	executionContext = new ExecutionContext(
		callingContext.lexicalEnvironment,
		callingContext.variableEnvironment,
		callingContext.thisBinding,
		callingContext.strict || strict
	);
	enterContext(executionContext);

	// Create the inner lexical environment if this is strict mode code
	if (executionContext.strict) {
		executionContext.variableEnvironment = executionContext.lexicalEnvironment =
			newDeclarativeEnvironment(executionContext.lexicalEnvironment);
	}

	// Bind the function and variable declarations to the global context
	env = executionContext.variableEnvironment.envRec;
	result = findDeclarations(code, executionContext);
	functions = result.functions;
	variables = result.variables;

	// Find all of the function declarations and bind them
	for (i = 0, len = functions.length; i < len; i++) {
		fn = functions[i].name.name;
		fo = functions[i]._funcObject = processFunctionDefinition(functions[i]);
		funcAlreadyDeclared = env.hasBinding(fn);

		if (!funcAlreadyDeclared) {
			env.createMutableBinding(fn, configurableBindings);
		} else if (env === getGlobalContext().variableEnvironment.envRec) {
			existingProp = getGlobalObject().getProperty(fn);
			if (existingProp.configurable) {
				descriptor = new DataPropertyDescriptor();
				descriptor.writable = true;
				descriptor.enumerable = true;
				descriptor.configurable = configurableBindings;
				getGlobalObject().defineOwnProperty(fn, descriptor, true);
			} else if (isAccessorDescriptor(existingProp) || (existingProp.writable !== true &&
					existingProp.enumerable !== true)) {
				throwNativeException('TypeError', fn +
					' is not a valid identifier name because a non-writable identifier with that name already exists');
			}
		}

		env.setMutableBinding(fn, fo, executionContext.strict);
	}

	// Find all of the variable declarations and bind them
	for (i = 0, len = variables.length; i < len; i++) {
		dn = variables[i].variableName;
		varAlreadyDeclared = env.hasBinding(dn);

		if (!varAlreadyDeclared) {
			env.createMutableBinding(dn, configurableBindings);
			env.setMutableBinding(dn, new UndefinedType(), executionContext.strict);
		}
	}

	return executionContext;
}

/**
 * Gets the global object
 *
 * @method module:Runtime.getGlobalObject
 * @return {module:base/types/object.ObjectType} The global object
 */
exports.getGlobalObject = getGlobalObject;
function getGlobalObject() {
	return globalObject;
}

/**
 * Enters an ambiguous block in the current context
 *
 * @method module:base/context.enterAmbiguousBlock
 */
exports.enterAmbiguousBlock = enterAmbiguousBlock;
function enterAmbiguousBlock() {
	getCurrentContext()._ambiguousBlock++;
}

/**
 * Exits an ambiguous block in the current context
 *
 * @method module:base/context.exitAmbiguousBlock
 */
exports.exitAmbiguousBlock = exitAmbiguousBlock;
function exitAmbiguousBlock() {
	getCurrentContext()._ambiguousBlock--;
}

/**
 * Checks if the current block in the current context is ambiguous
 *
 * @method module:base/context.isAmbiguousBlock
 */
exports.isAmbiguousBlock = isAmbiguousBlock;
function isAmbiguousBlock() {
	return !!getCurrentContext()._ambiguousBlock;
}

/**
 * Processes code in skipped mode
 *
 * @method module:base/context.processInSkippedMode
 * @param {Function} [...] The operations to run in skipped mode
 */
exports.processInSkippedMode = processInSkippedMode;
function processInSkippedMode() {
	var i, len,
		result;

	// Short-circuit skipped mode in blacklisted files
	if (Runtime.isCurrentFileBlacklisted()) {
		return;
	}

	// Enter skipped mode
	getCurrentContext().lexicalEnvironment.envRec._skippedModeStack.push(++skippedModeCounter);

	// Analyze the code
	try {
		for (i = 0, len = arguments.length; i < len; i++) {
			result = arguments[i]();
		}
	} catch(e) {
		if (RuleProcessor.inRecursionUnroll() || !e.isCodeProcessorException) {
			throw e;
		}
	}
	finally {
		// Exit skippd mode
		getCurrentContext().lexicalEnvironment.envRec._skippedModeStack.pop();
	}
	return result;
}

/**
 * Checks if we are skipped mode
 *
 * @method module:base/context.isSkippedMode
 * @return {boolean} Whether or not we are in skipped mode
 */
exports.isSkippedMode = isSkippedMode;
function isSkippedMode() {
	var stack = getContextStack(),
		i, len;
	for (i = 0, len = stack.length; i < len; i++) {
		if (stack[i].lexicalEnvironment.envRec._skippedModeStack.length) {
			return true;
		}
	}
	return false;
}

/**
 * Checks if the current context is in skipped mode
 *
 * @method module:base/context.isLocalSkippedMode
 * @return {boolean} Whether or not we are in skipped mode
 */
exports.isLocalSkippedMode = isLocalSkippedMode;
function isLocalSkippedMode() {
	return !!getCurrentContext().lexicalEnvironment.envRec._skippedModeStack.length;
}

/**
 * Gets the section of code that we are currently in. This is used to scope alternate values only to the appropriate
 * section of code in a context (typically a block, but not always).
 *
 * @method module:base/context.getSkippedSection
 * @return {number} The section id, which should be treated as an opaque id
 */
exports.getSkippedSection = getSkippedSection;
function getSkippedSection() {
	var contextStack = getContextStack(),
		skippedStack,
		i;
	for (i = contextStack.length - 1; i >= 0; i--) {
		skippedStack = contextStack[i].lexicalEnvironment.envRec._skippedModeStack;
		if (skippedStack.length) {
			return skippedStack[skippedStack.length - 1];
		}
	}
}

/**
 * Sets the given node as visited, taking the other states into account
 *
 * @method module:base/context.setVisited
 * @param {module:AST.node} ast The ast to set as visited
 */
exports.setVisited = setVisited;
function setVisited(ast) {
	if (isSkippedMode()) {
		ast._skipped = !ast._visited;
	} else {
		ast._visited = true;
		ast._skipped = false;
	}
}

/**
 * Enters the current try catch block
 *
 * @method module:base/context.enterTryCatch
 */
exports.enterTryCatch = enterTryCatch;
function enterTryCatch() {
	tryCatch++;
}

/**
 * Exits the current try catch block
 *
 * @method module:base/context.exitTryCatch
 */
exports.exitTryCatch = exitTryCatch;
function exitTryCatch() {
	tryCatch--;
}

/**
 * Checks if we are currently in a try-catch block
 *
 * @method module:base/context.inTryCatch
 */
exports.inTryCatch = inTryCatch;
function inTryCatch() {
	return !!tryCatch;
}

/**
 * Gets the current execution context
 *
 * @method module:base/context.getCurrentContext
 * @return {module:base/context~ExecutionContext} The current execution context
 */
exports.getCurrentContext = getCurrentContext;
function getCurrentContext() {
	return contextStack[contextStack.length - 1];
}

/**
 * Get the context stack
 *
 * @method module:base/context.getContextStack
 * @return {Array.<module:base/context~ExecutionContext>} The execution context stack
 */
exports.getContextStack = getContextStack;
function getContextStack() {
	return contextStack;
}

/**
 * Enters the given file, from a runtime perspective, i.e. if file a requires file b and calls foo in b from a, then the
 * current file becomes b, even though a is the current file being processed
 *
 * @method module:base/context.enterContext
 * @param {string} file The name of the file to enter
 */
exports.enterContext = enterContext;
function enterContext(context) {
	Runtime.log('trace', 'Entering new context');
	contextStack.push(context);
	if (context.isFunctionContext) {
		functionContextCount++;
	}
}

/**
 * Exits the current file, from a runtime perspective
 *
 * @method module:base/context.exitContext
 */
exports.exitContext = exitContext;
function exitContext() {
	Runtime.log('trace', 'Exiting context');
	var context = contextStack.pop();
	if (context.isFunctionContext) {
		functionContextCount--;
	}
	return context;
}

/**
 * Returns whether or not we are in a function context (i.e. not in global scope)
 *
 * @method module:base/context.inFunctionContext
 * @return {boolean} Whether or not we are in a function context
 */
exports.inFunctionContext = inFunctionContext;
function inFunctionContext() {
	return !!functionContextCount;
}

/**
 * Gets the global execution context
 *
 * @method module:base/context.getGlobalContext
 * @return {module:base/context~ExecutionContext} The global execution context
 */
exports.getGlobalContext = getGlobalContext;
function getGlobalContext() {
	return contextStack[0];
}

/**
 * Gets the module object of the current module context (i.e. the 'global' object associated with this module)
 *
 * @method module:base/context.getModuleContext
 * @return {module:base/types/object.ObjectType} The module object
 */
exports.getModuleContext = getModuleContext;
function getModuleContext() {
	return contextStack[1] || contextStack[0];
}

/**
 * ECMA-262 Spec: <em>When control enters an execution context for function code, an arguments object is created unless
 * (as specified in 10.5) the identifier arguments occurs as an Identifier in the function‘s FormalParameterList or
 * occurs as the Identifier of a VariableDeclaration or FunctionDeclaration contained in the function code.</em>
 *
 * @method module:base/context.createArgumentsObject
 * @param {module:base/types/function.FunctionType} func ECMA-262 Spec: <em>the function object whose code is to be evaluated</em>
 * @param {Array.<string>} names ECMA-262 Spec: <em>a List containing the function‘s formal parameter names</em>
 * @param {Array.<module:base.BaseType>} args ECMA-262 Spec: <em>the actual arguments passed to the [[call]] internal method</em>
 * @param {module:base/context~LexicalEnvironment} env ECMA-262 Spec: <em>the variable environment for the function code</em>
 * @param {boolean} strict ECMA-262 Spec: <em>a Boolean that indicates whether or not the function code is strict code</em>
 * @return {module:base/types/object.ObjectType} The arguments object
 * @see ECMA-262 Spec Chapter 10.4.2 and Chapter 10.6
 */
function createArgumentsObject(func, names, args, env, strict) {
	var len = args.length,
		obj = new ObjectType(),
		map = new ObjectType(),
		mappedNames = [],
		indx = len - 1,
		val,
		name;

	obj.className = 'Arguments';
	obj.defineOwnProperty('length', {
		value: new NumberType(len),
		writable: true,
		enumerable: false,
		configurable: true
	}, false, true);

	while (indx >= 0) {
		val = args[indx];
		obj.defineOwnProperty(indx, {
			value: val,
			writable: true,
			enumerable: true,
			configurable: true
		}, false, true);
		if (indx < names.length) {
			name = names[indx];
			if (!strict && !bindingExists(mappedNames, name)) {
				mappedNames.push(name);
				map.defineOwnProperty(indx, {
					// Note: we have to do this crazy parse since returns aren't allowedin global scope
					get: new FunctionType([], AST.parseString('function temp () { return ' + name + '; }').body[0], env, true),
					set: new FunctionType([name + '_arg'], AST.parseString(name + ' = ' + name + '_arg;'), env, true),
					configurable: true
				}, false, true);
			}
		}
		indx--;
	}

	if (mappedNames.length) {
		obj.parameterMap = map;

		obj.get = function get(p, alternate) {
			var isMapped = map.getOwnProperty(p, alternate),
				v;
			if (isMapped) {
				return map.get(p, alternate);
			} else {
				v = ObjectType.prototype.get.call(obj, p, alternate);
				if (p === 'callee' && v.className === 'Function' && v.strict) {
					throwNativeException('TypeError', 'Invalid identifier ' + p);
				}
				return v;
			}
		};

		obj.getOwnProperty = function getOwnProperty(p, alternate) {
			var desc = ObjectType.prototype.getOwnProperty.call(obj, p, alternate),
				alternateDesc,
				i, len,
				isMapped;

			if (!desc) {
				return;
			}

			isMapped = map.getOwnProperty(p, alternate);
			if (isMapped) {
				if (alternate) {
					alternateDesc = map.get(p, alternate);
					for (i = 0, len = desc.length; i < len; i++) {
						desc[i].value = alternateDesc[i];
					}
				} else {
					desc.value = map.get(p, alternate);
				}
			}
			return desc;
		};

		obj.defineOwnProperty = function defineOwnProperty(p, desc, throwFlag, suppressEvent) {
			var isMapped = map.getOwnProperty(p),
				allowed = ObjectType.prototype.defineOwnProperty.call(obj, p, desc, throwFlag, suppressEvent);

			if (!allowed) {
				if (throwFlag) {
					throwNativeException('TypeError', 'Cannot define property ' + p);
				}
				return false;
			}

			if (isMapped) {
				if (isAccessorDescriptor(desc)) {
					map['delete'](p, false);
				} else {
					if (desc.value) {
						map.put(p, desc.value, throwFlag, true);
					}
					if (desc.writable === false) {
						map['delete'](p, false);
					}
				}
			}
		};

		obj['delete'] = function (p, throwFlag) {
			var isMapped = map.getOwnProperty(p),
				result = ObjectType.prototype['delete'].call(obj, p, throwFlag);
			if (result && isMapped) {
				map['delete'](p, false);
			}
			return result;
		};
	}

	if (strict) {
		obj.defineOwnProperty('caller', {
			get: throwTypeError,
			set: throwTypeError,
			enumerable: false,
			configurable: false
		}, false, true);
		obj.defineOwnProperty('callee', {
			get: throwTypeError,
			set: throwTypeError,
			enumerable: false,
			configurable: false
		}, false, true);
	} else {
		obj.defineOwnProperty('callee', {
			value: func,
			writable: true,
			enumerable: false,
			configurable: true
		}, false, true);
	}

	return obj;
}

/**
 * Creates a function context
 *
 * @method module:base/context.createFunctionContext
 * @param {module:base/types/object.ObjectType} functionObject The function object of the context to be created.
 * @param {module:base/types/object.ObjectType} thisArg The object to bind the this pointer to
 * @param {Array.<module:base.BaseType>} argumentsList The list of function arguments
 * @return {module:base/context~ExecutionContext} The new global execution context
 * @see ECMA-262 Spec Chapter 10.4.3 and Chapter 10.5
 */
exports.createFunctionContext = createFunctionContext;
function createFunctionContext(functionObject, thisArg, argumentsList, scope) {

	// Create the context
	var env = newDeclarativeEnvironment(scope || functionObject.scope),
		configurableBindings = false,
		strict = functionObject.strict,
		executionContext,
		len, i,
		arg, argName,
		functions, variables, result,
		thisArgType = type(thisArg),
		thisBinding,
		fn,
		fo,
		funcAlreadyDeclared,
		existingProp,
		descriptor,
		argsObj,
		dn,
		varAlreadyDeclared;

	// Create the this binding
	if (functionObject.strict) {
		thisBinding = thisArg;
	} else if (thisArgType === 'Null' || thisArgType === 'Undefined') {
		thisBinding = getGlobalContext().thisBinding;
	} else if (thisArgType !== 'Object') {
		thisBinding = toObject(thisArg);
	} else {
		thisBinding = thisArg;
	}

	// Create the execution context and find declarations inside of it
	executionContext = new ExecutionContext(env, env, thisBinding, strict);
	executionContext.isFunctionContext = true;
	enterContext(executionContext);
	env = executionContext.variableEnvironment.envRec;
	result = findDeclarations(AST.createBodyContainer(functionObject.code), executionContext);
	functions = result.functions;
	variables = result.variables;

	// Initialize the arguments
	for (i = 0, len = functionObject.formalParameters.length; i < len; i++) {
		arg = argumentsList[i];
		argName = functionObject.formalParameters[i];
		if (!arg) {
			arg = new UndefinedType();
		}
		if (!env.hasBinding(argName)) {
			env.createMutableBinding(argName);
		}
		env.setMutableBinding(argName, arg, strict);
	}

	// Find all of the function declarations and bind them
	for (i = 0, len = functions.length; i < len; i++) {
		fn = functions[i].name.name;
		fo = functions[i]._funcObject = processFunctionDefinition(functions[i]);
		funcAlreadyDeclared = env.hasBinding(fn);

		if (!funcAlreadyDeclared) {
			env.createMutableBinding(fn, configurableBindings);
		} else if (env === getGlobalContext().variableEnvironment.envRec) {
			existingProp = getGlobalObject().getProperty(fn);
			if (existingProp.configurable) {
				descriptor = new DataPropertyDescriptor();
				descriptor.writable = true;
				descriptor.enumerable = true;
				descriptor.configurable = configurableBindings;
				getGlobalObject().defineOwnProperty(fn, descriptor, true);
			} else if (isAccessorDescriptor(existingProp) || (existingProp.writable !== true &&
					existingProp.enumerable !== true)) {
				throwNativeException('TypeError', fn +
					' is not a valid identifier name because a non-writable identifier with that name already exists');
			}
		}

		env.setMutableBinding(fn, fo, strict);
	}

	// Initialize the arguments variable
	if (!env.hasBinding('arguments')) {
		argsObj = createArgumentsObject(functionObject, functionObject.formalParameters, argumentsList, executionContext.variableEnvironment, strict);
		if (strict) {
			env.createImmutableBinding('arguments');
			env.initializeImmutableBinding('arguments', argsObj);
		} else {
			env.createMutableBinding('arguments');
			env.setMutableBinding('arguments', argsObj, false);
		}
	}

	// Find all of the variable declarations and bind them
	for (i = 0, len = variables.length; i < len; i++) {
		dn = variables[i].variableName;
		varAlreadyDeclared = env.hasBinding(dn);

		if (!varAlreadyDeclared) {
			env.createMutableBinding(dn, configurableBindings);
			env.setMutableBinding(dn, new UndefinedType(), strict);
		}
	}

	// Return the context
	return executionContext;
}

/**
 * Wraps a native call method and provides necessary context setup and cleanup
 *
 * @method module:base/context.wrapNativeCall
 * @param {Function} func The function to wrap
 * @param {boolean} isConstructor Whether or not this is a constructure (constructors are handled differently)
 * @return {Function} The newly wrapped function
 */
exports.wrapNativeCall = wrapNativeCall;
function wrapNativeCall (func, isConstructor) {

	return function (thisVal) {

		// Create the context
		var env = newDeclarativeEnvironment(getCurrentContext().lexicalEnvironment),
			executionContext = new ExecutionContext(env, env, isConstructor ? getModuleContext().thisBinding : thisVal, false),
			result;

		executionContext.isFunctionContext = true;
		enterContext(executionContext);

		try {
			result = func.apply(this, arguments);
		} finally {
			exitContext();
		}

		return result;
	};
}

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Contains all of the global objects (Math, eval, Object, etc)
 *
 * @module base/conversion
 */
/*global
AST,
Runtime,
RuleProcessor,
FunctionTypeBase,
util,
areAnyUnknown,
UnknownType,
type,
handleRecoverableNativeException,
createEvalContext,
UndefinedType,
throwNativeException,
toString,
toInt32,
NumberType,
BooleanType,
toNumber,
StringType,
ObjectType,
addReadOnlyProperty,
addNonEnumerableProperty,
NullType,
ArrayType,
isCallable,
toInteger,
wrapNativeCall,
inTryCatch,
getCurrentContext
*/

/*****************************************
 *
 * Global methods and objects
 *
 *****************************************/

/**
 * eval method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.1.2.1
 */
function EvalFunction(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(EvalFunction, FunctionTypeBase);
EvalFunction.prototype.callFunction = function callFunction(thisVal, args, options) {

	// Variable declarations
	var x = args[0],
		ast,
		result,
		filename = (options && options.filename) || Runtime.getCurrentLocation().filename;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Step 1
	if (!x) {
		return new UndefinedType();
	}
	if (type(x) !== 'String') {
		return x;
	}

	// Step 2
	ast = AST.parseString(x.value, filename);
	if (ast.syntaxError) {
		if (!inTryCatch() && Runtime.options.nativeExceptionRecovery && !Runtime.options.exactMode) {
			Runtime.reportUglifyError(ast);
			return new UnknownType();
		} else {
			throwNativeException('SyntaxError', ast.message);
		}
	}

	// Step 3
	createEvalContext(getCurrentContext(), ast, RuleProcessor.isBlockStrict(ast), options && options.isDirectEval);

	// Step 4
	try {
		result = ast.processRule();
	} finally {
		// Step 5
		exitContext();
	}

	// Step 6
	if (result[0] === 'normal') {
		return result[1] ? result[1] : new UndefinedType();
	} else {
		if (result[1]) {
			if (result[1].className.match('Error$')) {
				throwNativeException(result[1].get('name'), result[1].get('message'));
			} else {
				throwNativeException('Error', toString(result[1]).value);
			}
		} else {
			throwNativeException('Error', 'Missing throw value');
		}
	}
};

/**
 * parseInt method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.1.2.2
 */
function ParseIntFunction(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(ParseIntFunction, FunctionTypeBase);
ParseIntFunction.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var string,
		radix,
		s,
		r;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1, 2, and 6
	string = args[0];
	radix = args[1];
	s = toString(string).value.trim();
	r = radix && type(radix) !== 'Undefined' ? toInt32(radix).value : undefined;

	// Use the built-in method to perform the parseInt
	return new NumberType(parseInt(s, r));
});

/**
 * parseFloat method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.1.2.3
 */
function ParseFloatFunction(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(ParseFloatFunction, FunctionTypeBase);
ParseFloatFunction.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var string,
		s;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Steps 1 and 2
	string = args[0];
	s = toString(string).value.trim();

	// Use the built-in method to perform the parseFloat
	return new NumberType(parseFloat(s));
});

/**
 * isNaN method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.1.2.4
 */
function IsNaNFunction(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(IsNaNFunction, FunctionTypeBase);
IsNaNFunction.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Use the built-in method to perform the isNaN
	return new BooleanType(isNaN(toNumber(args[0]).value));
});

/**
 * isFinite method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.1.2.5
 */
function IsFiniteFunction(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(IsFiniteFunction, FunctionTypeBase);
IsFiniteFunction.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Use the built-in method to perform the isFinite
	return new BooleanType(isFinite(toNumber(args[0]).value));
});

/**
 * decodeURI method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.1.3.1
 */
function DecodeURIFunction(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(DecodeURIFunction, FunctionTypeBase);
DecodeURIFunction.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	var decodedURI;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	try {
		decodedURI = new StringType(decodeURI(toString(args[0]).value));
	} catch (e) {
		if (!e.isCodeProcessorException) {
			handleRecoverableNativeException('URIError', e.toString());
			decodedURI = new UnknownType();
		} else {
			throw e;
		}
	}

	// Use the built-in method to perform the decodeURI
	return decodedURI;
});

/**
 * decodeURIComponent method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.1.3.2
 */
function DecodeURIComponentFunction(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(DecodeURIComponentFunction, FunctionTypeBase);
DecodeURIComponentFunction.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	var decodedURIComponent;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	try {
		decodedURIComponent = new StringType(decodeURIComponent(toString(args[0]).value));
	} catch (e) {
		if (!e.isCodeProcessorException) {
			handleRecoverableNativeException('URIError', e.toString());
			decodedURIComponent = new UnknownType();
		} else {
			throw e;
		}
	}

	// Use the built-in method to perform the decodeURI
	return decodedURIComponent;
});

/**
 * encodeURI method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.1.3.3
 */
function EncodeURIFunction(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(EncodeURIFunction, FunctionTypeBase);
EncodeURIFunction.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	var encodedURI;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	try {
		encodedURI = new StringType(encodeURI(toString(args[0]).value));
	} catch (e) {
		if (!e.isCodeProcessorException) {
			handleRecoverableNativeException('URIError', e.toString());
			encodedURI = new UnknownType();
		} else {
			throw e;
		}
	}

	// Use the built-in method to perform the decodeURI
	return encodedURI;
});

/**
 * encodeURIComponent method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.1.3.4
 */
function EncodeURIComponentFunction(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(EncodeURIComponentFunction, FunctionTypeBase);
EncodeURIComponentFunction.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	var encodedURIComponent;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	try {
		encodedURIComponent = new StringType(encodeURIComponent(toString(args[0]).value));
	} catch (e) {
		if (!e.isCodeProcessorException) {
			handleRecoverableNativeException('URIError', e.toString());
			encodedURIComponent = new UnknownType();
		} else {
			throw e;
		}
	}

	// Use the built-in method to perform the decodeURI
	return encodedURIComponent;
});

/*****************************************
 *
 * Chapter 15 - Global Objects
 *
 *****************************************/

// ******** Math Object ********

/**
 * abs() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.1
 */
function MathAbsFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(MathAbsFunc, FunctionTypeBase);
MathAbsFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var x = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (!x) {
		return new NumberType(NaN);
	} else {
		return new NumberType(Math.abs(toNumber(x).value));
	}
});

/**
 * acos() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.2
 */
function MathAcosFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(MathAcosFunc, FunctionTypeBase);
MathAcosFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var x = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (!x) {
		return new NumberType(NaN);
	} else {
		return new NumberType(Math.acos(toNumber(x).value));
	}
});

/**
 * asin() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.3
 */
function MathAsinFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(MathAsinFunc, FunctionTypeBase);
MathAsinFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var x = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	return new NumberType(x ? Math.asin(toNumber(x).value) : NaN);
});

/**
 * atan() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.4
 */
function MathAtanFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(MathAtanFunc, FunctionTypeBase);
MathAtanFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var x = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (!x) {
		return new NumberType(NaN);
	} else {
		return new NumberType(Math.atan(toNumber(x).value));
	}
});

/**
 * atan2() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.5
 */
function MathAtan2Func(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(MathAtan2Func, FunctionTypeBase);
MathAtan2Func.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var x = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (!x) {
		return new NumberType(NaN);
	} else {
		return new NumberType(Math.abs(toNumber(x).value));
	}
});

/**
 * ceil() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.6
 */
function MathCeilFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(MathCeilFunc, FunctionTypeBase);
MathCeilFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var x = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (!x) {
		return new NumberType(NaN);
	} else {
		return new NumberType(Math.ceil(toNumber(x).value));
	}
});

/**
 * cos() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.7
 */
function MathCosFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(MathCosFunc, FunctionTypeBase);
MathCosFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var x = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (!x) {
		return new NumberType(NaN);
	} else {
		return new NumberType(Math.cos(toNumber(x).value));
	}
});

/**
 * exp() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.8
 */
function MathExpFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(MathExpFunc, FunctionTypeBase);
MathExpFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var x = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (!x) {
		return new NumberType(NaN);
	} else {
		return new NumberType(Math.exp(toNumber(x).value));
	}
});

/**
 * floor() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.9
 */
function MathFloorFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(MathFloorFunc, FunctionTypeBase);
MathFloorFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var x = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (!x) {
		return new NumberType(NaN);
	} else if (type(x) === 'Unknown') {
		return new UnknownType();
	} else {
		return new NumberType(Math.floor(toNumber(x).value));
	}
});

/**
 * log() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.10
 */
function MathLogFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(MathLogFunc, FunctionTypeBase);
MathLogFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var x = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (!x) {
		return new NumberType(NaN);
	} else {
		return new NumberType(Math.log(toNumber(x).value));
	}
});

/**
 * max() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.11
 */
function MathMaxFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(MathMaxFunc, FunctionTypeBase);
MathMaxFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var i, len,
		value,
		values = [];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	for (i = 0, len = args.length; i < len; i++) {
		value = toNumber(args[i]);
		if (type(value) === 'Unknown') {
			return new UnknownType();
		}
		values.push(toNumber(value).value);
	}
	return new NumberType(Math.max.apply(this, values));
});

/**
 * min() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.12
 */
function MathMinFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(MathMinFunc, FunctionTypeBase);
MathMinFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var i, len,
		value,
		values = [];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	for (i = 0, len = args.length; i < len; i++) {
		value = toNumber(args[i]);
		if (type(value) === 'Unknown') {
			return new UnknownType();
		}
		values.push(toNumber(value).value);
	}
	return new NumberType(Math.min.apply(this, values));
});

/**
 * pow() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.13
 */
function MathPowFunc(className) {
	FunctionTypeBase.call(this, 2, className || 'Function');
}
util.inherits(MathPowFunc, FunctionTypeBase);
MathPowFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var x = args[0],
		y = args[1];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (!x || !y) {
		return new NumberType(NaN);
	} else {
		return new NumberType(Math.pow(toNumber(x).value, toNumber(y).value));
	}
});

/**
 * random() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.14
 */
function MathRandomFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(MathRandomFunc, FunctionTypeBase);
MathRandomFunc.prototype.callFunction = wrapNativeCall(function callFunction() {
	if (Runtime.options.exactMode) {
		return new NumberType(Math.random());
	} else {
		return new UnknownType();
	}
});

/**
 * round() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.15
 */
function MathRoundFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(MathRoundFunc, FunctionTypeBase);
MathRoundFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var x = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (!x) {
		return new NumberType(NaN);
	} else {
		return new NumberType(Math.round(toNumber(x).value));
	}
});

/**
 * sin() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.16
 */
function MathSinFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(MathSinFunc, FunctionTypeBase);
MathSinFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var x = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (!x) {
		return new NumberType(NaN);
	} else {
		return new NumberType(Math.sin(toNumber(x).value));
	}
});

/**
 * sqrt() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.17
 */
function MathSqrtFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(MathSqrtFunc, FunctionTypeBase);
MathSqrtFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var x = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (!x) {
		return new NumberType(NaN);
	} else {
		return new NumberType(Math.sqrt(toNumber(x).value));
	}
});

/**
 * tan() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8.2.17
 */
function MathTanFunc(className) {
	FunctionTypeBase.call(this, 1, className || 'Function');
}
util.inherits(MathTanFunc, FunctionTypeBase);
MathTanFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var x = args[0];

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	if (!x) {
		return new NumberType(NaN);
	} else {
		return new NumberType(Math.tan(toNumber(x).value));
	}
});

/**
 * Math Object
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.8
 */
function MathObject(className) {
	ObjectType.call(this, className);

	// Properties
	addReadOnlyProperty(this, 'E', new NumberType(Math.E));
	addReadOnlyProperty(this, 'LN10', new NumberType(Math.LN10));
	addReadOnlyProperty(this, 'LN2', new NumberType(Math.LN2));
	addReadOnlyProperty(this, 'LOG2E', new NumberType(Math.LOG2E));
	addReadOnlyProperty(this, 'LOG10E', new NumberType(Math.LOG10E));
	addReadOnlyProperty(this, 'PI', new NumberType(Math.PI));
	addReadOnlyProperty(this, 'SQRT1_2', new NumberType(Math.SQRT1_2));
	addReadOnlyProperty(this, 'SQRT2', new NumberType(Math.SQRT2));

	// Methods
	addNonEnumerableProperty(this, 'abs', new MathAbsFunc());
	addNonEnumerableProperty(this, 'acos', new MathAcosFunc());
	addNonEnumerableProperty(this, 'asin', new MathAsinFunc());
	addNonEnumerableProperty(this, 'atan', new MathAtanFunc());
	addNonEnumerableProperty(this, 'atan2', new MathAtan2Func());
	addNonEnumerableProperty(this, 'ceil', new MathCeilFunc());
	addNonEnumerableProperty(this, 'cos', new MathCosFunc());
	addNonEnumerableProperty(this, 'exp', new MathExpFunc());
	addNonEnumerableProperty(this, 'floor', new MathFloorFunc());
	addNonEnumerableProperty(this, 'log', new MathLogFunc());
	addNonEnumerableProperty(this, 'max', new MathMaxFunc());
	addNonEnumerableProperty(this, 'min', new MathMinFunc());
	addNonEnumerableProperty(this, 'pow', new MathPowFunc());
	addNonEnumerableProperty(this, 'random', new MathRandomFunc());
	addNonEnumerableProperty(this, 'round', new MathRoundFunc());
	addNonEnumerableProperty(this, 'sin', new MathSinFunc());
	addNonEnumerableProperty(this, 'sqrt', new MathSqrtFunc());
	addNonEnumerableProperty(this, 'tan', new MathTanFunc());
}
util.inherits(MathObject, ObjectType);

// ******** JSON Object ********

/**
 * parse() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.12.2
 */
function JSONParseFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(JSONParseFunc, FunctionTypeBase);
JSONParseFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var text = args[0],
		reviver = args[1],
		nativeObject;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	// Parse the code
	try {
		nativeObject = JSON.parse(toString(text).value);
	} catch(e) {
		handleRecoverableNativeException('SyntaxError', e.message);
		return new UnknownType();
	}

	// Convert the result into an object type
	function processObject(nativeObj) {
		var converted,
			p,
			child,
			i, len;

		function setProperty(k, v, obj) {
			if (reviver) {
				converted.put(k, v, true, true);
				v = reviver.callFunction(obj, [k, v]);
				if (type(v) !== 'Undefined') {
					converted.put(k, v, true);
				} else {
					converted['delete'](k, false);
				}
			} else {
				converted.put(k, v, true, true);
			}
		}

		switch(typeof nativeObj) {
			case 'undefined':
				return new UndefinedType();
			case 'null':
				return new NullType();
			case 'string':
				return new StringType(nativeObj);
			case 'number':
				return new NumberType(nativeObj);
			case 'boolean':
				return new BooleanType(nativeObj);
			case 'object':
				if (Array.isArray(nativeObj)) {
					converted = new ArrayType();
					for (i = 0, len = nativeObj.length; i < len; i++) {
						child = processObject(nativeObj[i]);
						setProperty(i, child, converted);
					}
				} else {
					converted = new ObjectType();
					for (p in nativeObj) {
						setProperty(p, processObject(nativeObj[p]), converted);
					}
				}
				return converted;
		}
	}
	return processObject(nativeObject);
});

/**
 * parse() prototype method
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.12.3
 */
function JSONStringifyFunc(className) {
	FunctionTypeBase.call(this, 0, className || 'Function');
}
util.inherits(JSONStringifyFunc, FunctionTypeBase);
JSONStringifyFunc.prototype.callFunction = wrapNativeCall(function callFunction(thisVal, args) {

	// Variable declarations
	var value = args[0],
		replacer = args[1],
		space = args[2],
		replacerFunction,
		propertyList,
		v,
		i, len,
		gap,
		stack = [],
		indent = '',
		wrapper,
		result;

	// Validate the parameters
	if (areAnyUnknown((args || []).concat(thisVal))) {
		return new UnknownType();
	}

	function str(key, holder) {

		// Step 1
		var value = holder.get(key),
			toJSON;

		// Step 2
		if (type(value) === 'Object') {
			toJSON = value.get('toJSON');
			if (type(toJSON) === 'Unknown') {
				throw 'Unknown';
			}
			if (isCallable(toJSON)) {
				value = toJSON.callFunction(value, [key]);
			}
		}

		// Step 3
		if (replacerFunction) {
			value = replacerFunction.callFunction(holder, [key, value]);
		}

		// Step 4
		if (type(value) == 'Object') {
			if (value.className === 'Number') {
				value = toNumber(value);
			}
			if (value.className === 'String') {
				value = toString(value);
			}
			if (value.className === 'Boolean') {
				value = new BooleanType(value.primitiveValue);
			}
		}

		// Steps 5-7
		if (type(value) === 'Null') {
			return 'null';
		} else if (value.value === false) {
			return 'false';
		} else if (value.value === true) {
			return 'true';
		}

		// Step 8
		if (type(value) === 'String') {
			return quote(value.value);
		}

		// Step 9
		if (type(value) === 'Number') {
			if (isFinite(value.value)) {
				return toString(value).value;
			} else {
				return 'null';
			}
		}

		// Step 10
		if (type(value) === 'Unknown') {
			throw 'Unknown';
		}
		if (type(value) === 'Object' && isCallable(value)) {
			if (value.className === 'Array') {
				return ja(value);
			}
			return jo(value);
		}

		return undefined;
	}

	function quote(value) {
		return JSON.stringify(value);
	}

	function jo(value) {

		var stepBack = indent,
			k,
			p,
			i, len,
			partial = [],
			strP,
			member,
			fin;

		// Step 1
		if (stack.indexOf(value) !== -1) {
			handleRecoverableNativeException('TypeError', 'Invalid object type');
			throw 'Unknown';
		}

		// Step 2
		stack.push(value);

		// Step 4
		indent += gap;

		// Steps 5 and 6
		if (propertyList) {
			k = propertyList;
		} else {
			k = [];
			value._getPropertyNames().forEach(function (p) {
				if (value._lookupProperty(p).enumerable) {
					k.push(p);
				}
			});
		}

		// Step 8
		for (i = 0, len = k.length; i < len; i++) {
			p = k[i];
			strP = str(p, value);
			if (strP) {
				member = quote(p) + ':';
				if (gap) {
					member += space;
				}
				member += strP;
				partial.push(member);
			}
		}

		// Steps 9 and 10
		if (!partial) {
			fin = '{}';
		} else {
			if (!gap) {
				fin = '{' + partial.join(',') + '}';
			} else {
				fin = '{\n' + indent + partial.join(',\n' + indent) + '\n' + stepBack + '}';
			}
		}

		// Step 11
		stack.pop();

		// Step 12
		indent = stepBack;

		// Step 12
		return fin;
	}

	function ja(value) {

		var stepBack = indent,
			partial = [],
			len,
			index = 0,
			strP,
			fin;

		// Step 1
		if (stack.indexOf(value) !== -1) {
			handleRecoverableNativeException('TypeError', 'Invalid object type');
			throw 'Unknown';
		}

		// Step 2
		stack.push(value);

		// Step 4
		indent += gap;

		// Step 6
		len = value.get('length').value;

		// Step 8
		while (index < len) {
			strP = str(toString(new NumberType(index)).value, value);
			if (strP) {
				partial.push(strP);
			} else {
				partial.push('null');
			}
			index++;
		}

		// Steps 9 and 10
		if (!partial) {
			fin = '[]';
		} else {
			if (!gap) {
				fin = '[' + partial.join(',') + ']';
			} else {
				fin = '[\n' + indent + partial.join(',\n' + indent) + '\n' + stepBack + ']';
			}
		}

		// Step 11
		stack.pop();

		// Step 12
		indent = stepBack;

		// Step 12
		return fin;
	}

	// Parse the replacer argument, Step 4
	if (replacer && type(replacer) === 'Object') {
		if (isCallable(replacer)) {
			replacerFunction = replacer;
		} else if (replacer.className === 'Array') {
			propertyList = [];
			for (i = 0, len = toInteger(replacer.get('length')).value; i < len; i++) {
				v = replacer.get(i);
				if (v.className === 'String' || v.className === 'Number') {
					v = toString(v).value;
					if (propertyList.indexOf(v) === -1) {
						propertyList.push(v);
					}
				}
			}
		}
	}

	// Parse the space argument, steps 5-8
	if (space) {
		if (space.className === 'Number') {
			space = Math.min(10, toNumber(space).value);
			gap = (new Array(space)).join(' ');
		} else if (space.className === 'String') {
			gap = toString(space).value.substring(0, 9);
			space = space.value;
		} else {
			space = undefined;
			gap = '';
		}
	} else {
		gap = '';
	}

	// Step 10
	wrapper = new ObjectType();
	wrapper.defineOwnProperty('', {
		value: value,
		writable: true,
		enumerable: true,
		configurable: true
	}, false);

	// Step 11
	try {
		result = str('', wrapper);
	} catch(e) {
		if (e === 'Unknown') {
			return new UnknownType();
		} else {
			throw e;
		}
	}
	if (typeof result == 'undefined') {
		return new UndefinedType();
	} else {
		return new StringType(result);
	}
});

/**
 * JSON Object
 *
 * @private
 * @see ECMA-262 Spec Chapter 15.12
 */
function JSONObject(className) {
	ObjectType.call(this, className);

	addNonEnumerableProperty(this, 'parse', new JSONParseFunc());
	addNonEnumerableProperty(this, 'stringify', new JSONStringifyFunc());
}
util.inherits(JSONObject, ObjectType);

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Contains the VM initialization method
 *
 * @module base/init
 */
/*global
RuleProcessor,
throwNativeException,
createGlobalContext,
initGlobalAST,
prototypes,
throwTypeError,
addReadOnlyProperty,
FunctionType,
NumberType,
UndefinedType,
NumberPrototypeType,
BooleanPrototypeType,
StringPrototypeType,
ObjectPrototypeType,
ArrayPrototypeType,
FunctionPrototypeType,
RegExpPrototypeType,
DatePrototypeType,
ErrorPrototypeType,
NumberConstructor,
BooleanConstructor,
StringConstructor,
ObjectConstructor,
ArrayConstructor,
FunctionConstructor,
RegExpConstructor,
DateConstructor,
ErrorConstructor,
EvalFunction,
ParseIntFunction,
ParseFloatFunction,
IsNaNFunction,
IsFiniteFunction,
DecodeURIFunction,
DecodeURIComponentFunction,
EncodeURIFunction,
EncodeURIComponentFunction,
MathObject,
JSONObject,
globalObject,
addNonEnumerableProperty,
getGlobalContext
*/

/*****************************************
 *
 * VM Initialization
 *
 *****************************************/

/**
 * Injects the global objects into the global namespace
 *
 * @method module:base/init.init
 */
exports.init = init;
function init(ast) {

	createGlobalContext(ast && RuleProcessor.isBlockStrict(ast));

	var globalContext = getGlobalContext(),
		globalObjects = {};

	function addObject(name, value) {
		globalObject.defineOwnProperty(name, {
			value: value,
			writable: true,
			enumerable: false,
			configurable: true
		}, false, true);
	}

	// Create the prototypes
	prototypes.Object = new ObjectPrototypeType();
	prototypes.Function = new FunctionPrototypeType();
	prototypes.Number = new NumberPrototypeType();
	prototypes.Boolean = new BooleanPrototypeType();
	prototypes.String = new StringPrototypeType();
	prototypes.Array = new ArrayPrototypeType();
	prototypes.RegExp = new RegExpPrototypeType();
	prototypes.Date = new DatePrototypeType();
	prototypes.Error = new ErrorPrototypeType('Error');
	prototypes.EvalError = new ErrorPrototypeType('EvalError');
	prototypes.RangeError = new ErrorPrototypeType('RangeError');
	prototypes.ReferenceError = new ErrorPrototypeType('ReferenceError');
	prototypes.SyntaxError = new ErrorPrototypeType('SyntaxError');
	prototypes.TypeError = new ErrorPrototypeType('TypeError');
	prototypes.URIError = new ErrorPrototypeType('URIError');

	// Set the error prototypes
	prototypes.EvalError.objectPrototype =
		prototypes.RangeError.objectPrototype =
		prototypes.ReferenceError.objectPrototype =
		prototypes.SyntaxError.objectPrototype =
		prototypes.TypeError.objectPrototype =
		prototypes.URIError.objectPrototype =
		prototypes.Error;

	// Create the global objects and set the constructors
	addNonEnumerableProperty(prototypes.Number, 'constructor', globalObjects.Number = new NumberConstructor(), false, true);
	addNonEnumerableProperty(prototypes.Boolean, 'constructor', globalObjects.Boolean = new BooleanConstructor(), false, true);
	addNonEnumerableProperty(prototypes.String, 'constructor', globalObjects.String = new StringConstructor(), false, true);
	addNonEnumerableProperty(prototypes.Object, 'constructor', globalObjects.Object = new ObjectConstructor(), false, true);
	addNonEnumerableProperty(prototypes.Array, 'constructor', globalObjects.Array = new ArrayConstructor(), false, true);
	addNonEnumerableProperty(prototypes.Function, 'constructor', globalObjects.Function = new FunctionConstructor(), false, true);
	addNonEnumerableProperty(prototypes.RegExp, 'constructor', globalObjects.RegExp = new RegExpConstructor(), false, true);
	addNonEnumerableProperty(prototypes.Date, 'constructor', globalObjects.Date = new DateConstructor(), false, true);
	addNonEnumerableProperty(prototypes.Error, 'constructor', globalObjects.Error = new ErrorConstructor('Error'), false, true);
	addNonEnumerableProperty(prototypes.EvalError, 'constructor', globalObjects.EvalError = new ErrorConstructor('EvalError'), false, true);
	addNonEnumerableProperty(prototypes.RangeError, 'constructor', globalObjects.RangeError = new ErrorConstructor('RangeError'), false, true);
	addNonEnumerableProperty(prototypes.ReferenceError, 'constructor', globalObjects.ReferenceError = new ErrorConstructor('ReferenceError'), false, true);
	addNonEnumerableProperty(prototypes.SyntaxError, 'constructor', globalObjects.SyntaxError = new ErrorConstructor('SyntaxError'), false, true);
	addNonEnumerableProperty(prototypes.TypeError, 'constructor', globalObjects.TypeError = new ErrorConstructor('TypeError'), false, true);
	addNonEnumerableProperty(prototypes.URIError, 'constructor', globalObjects.URIError = new ErrorConstructor('URIError'), false, true);

	// Create the throw type error
	// TODO: this should be FunctionTypeBase
	throwTypeError = new FunctionType([], undefined, globalContext.lexicalEnvironment, globalContext.strict);
	throwTypeError.callFunction = function () {
		throwNativeException('TypeError', '');
	};
	throwTypeError.extensible = false;

	// Properties
	addReadOnlyProperty(globalObject, 'NaN', new NumberType(NaN));
	addReadOnlyProperty(globalObject, 'Infinity', new NumberType(Infinity));
	addReadOnlyProperty(globalObject, 'undefined', new UndefinedType());

	// Methods
	addObject('eval', new EvalFunction());
	addObject('parseInt', new ParseIntFunction());
	addObject('parseFloat', new ParseFloatFunction());
	addObject('isNaN', new IsNaNFunction());
	addObject('isFinite', new IsFiniteFunction());
	addObject('decodeURI', new DecodeURIFunction());
	addObject('decodeURIComponent', new DecodeURIComponentFunction());
	addObject('encodeURI', new EncodeURIFunction());
	addObject('encodeURIComponent', new EncodeURIComponentFunction());

	// Types
	addObject('Object', globalObjects.Object);
	addObject('Function', globalObjects.Function);
	addObject('Array', globalObjects.Array);
	addObject('String', globalObjects.String);
	addObject('Boolean', globalObjects.Boolean);
	addObject('Number', globalObjects.Number);
	addObject('Date', globalObjects.Date);
	addObject('RegExp', globalObjects.RegExp);
	addObject('Error', globalObjects.Error);
	addObject('EvalError', globalObjects.EvalError);
	addObject('RangeError', globalObjects.RangeError);
	addObject('ReferenceError', globalObjects.ReferenceError);
	addObject('SyntaxError', globalObjects.SyntaxError);
	addObject('TypeError', globalObjects.TypeError);
	addObject('URIError', globalObjects.URIError);

	// Objects
	addObject('Math', new MathObject());
	addObject('JSON', new JSONObject());

	// Initialize the global scope AST
	if (ast) {
		initGlobalAST(ast);
	}
}

/**
 * <p>Copyright (c) 2009-2013 by Appcelerator, Inc. All Rights Reserved.
 * Please see the LICENSE file for information about licensing.</p>
 *
 * Contains exception handling functions
 *
 * @module base/exceptions
 */
/*global
Runtime,
StringType,
getValue,
getIdentifierReference,
isSkippedMode,
getGlobalContext,
type,
RuleProcessor
*/

/*****************************************
 *
 * Exception handling
 *
 *****************************************/

/**
 * Throws a native exception if exception recovery is turned off, else reports an error but doesn't actually throw
 * the exception.
 *
 * @method module:base/exceptions.handleRecoverableNativeException
 * @param {string} exceptionType The type of exception, e.g. 'TypeError'
 * @param {string} message The exception message
 */
exports.handleRecoverableNativeException = handleRecoverableNativeException;
function handleRecoverableNativeException(exceptionType, message) {
	if (!isSkippedMode()) {
		if (Runtime.options.nativeExceptionRecovery && !Runtime.options.exactMode) {
			Runtime.reportError(exceptionType, message, RuleProcessor.getStackTrace());
		} else {
			throwNativeException(exceptionType, message);
		}
	}
}

/**
 * Throws a native exception. Due to the internal nature, we have to do a little tricker to get the result inserted into
 * the rule processing flow.
 *
 * @method module:base/exceptions.throwNativeException
 * @param {string} exceptionType The type of exception, e.g. 'TypeError'
 * @param {string} message The exception message
 */
exports.throwNativeException = throwNativeException;
function throwNativeException (exceptionType, message) {
	var exc = getValue(getIdentifierReference(getGlobalContext().variableEnvironment, exceptionType, false));
	throwException(exc.construct([new StringType(message)]));
}

/**
 * Throws a native exception. Due to the internal nature, we have to do a little trick to get the result inserted into
 * the rule processing flow.
 *
 * @method module:base/exceptions.throwException
 * @param {string} exceptionType The type of exception, e.g. 'TypeError'
 * @param {string} message The exception message
 */
exports.throwException = throwException;
function throwException (exception) {
	var error;

	// Set the exception
	debugger;
	exception.stackTrace = RuleProcessor.getStackTrace();
	Runtime._exception = exception;

	error = new Error('VM exception flow controller');
	error.isCodeProcessorException = true;

	throw error;
}

/**
 * Processes the variety of forms that exceptions can take into a single manageable type
 *
 * @method module:base/exceptions.getExceptionMessage
 * @return {string} The exception message
 */
exports.getExceptionMessage = getExceptionMessage;
function getExceptionMessage(exception) {
	if (type(exception) === 'String') {
		exception = exception.value;
	} else if (type(exception) === 'Unknown') {
		exception = '<unknown>';
	} else {
		exception = exception._lookupProperty('message').value;
		if (type(exception) === 'Unknown') {
			exception = '<unknown>';
		} else {
			exception = exception.value;
		}
	}
	return exception;
}

/*****************************************
 *
 * Cloner
 *
 *****************************************/
/*global
Map,
UndefinedType,
NullType,
StringType,
NumberType,
BooleanType,
ObjectType,
FunctionType,
isDataDescriptor,
ReferenceType,
ArrayType,
RegExpType,
UnknownType,
DeclarativeEnvironmentRecord,
ObjectEnvironmentRecord,
ExecutionContext,
LexicalEnvironment,
StringPrototypeType,
NumberPrototypeType,
BooleanPrototypeType
*/

// Note: this code is not used anymore, but it's kinda neat so worth keeping around

exports.Cloner = Cloner;
function Cloner() {
	this._valueMap = new Map();
}

Cloner.prototype.cloneContext = function cloneContext(source) {
	var newEnvRec = source.lexicalEnvironment.envRec instanceof ObjectEnvironmentRecord ?
			this.cloneObjectEnvironment(source.lexicalEnvironment) :
			this.cloneDeclarativeEnvironment(source.lexicalEnvironment),
		newContext = new ExecutionContext(
			newEnvRec,
			newEnvRec,
			source.thisBinding && this.cloneObject(source.thisBinding),
			source.strict
		);
	newContext._ambiguousBlock = source._ambiguousBlock;
	return newContext;
};

Cloner.prototype.cloneDeclarativeEnvironment = function cloneDeclarativeEnvironment(source) {
	var newEnvRec = new DeclarativeEnvironmentRecord(),
		outer,
		binding,
		bindingEntry,
		cloneAlternateValues = function cloneAlternateValues(values) {
			var p,
				cloned = {};
			for (p in values) {
				cloned[p] = this.cloneValue(values[p]);
			}
			return cloned;
		}.bind(this);

	// Clone the bindings
	for (binding in source.envRec._bindings) {
		bindingEntry = source.envRec._bindings[binding];
		newEnvRec._bindings[binding] = {
			value: this.cloneValue(bindingEntry.value),
			alternateValues: cloneAlternateValues(bindingEntry.alternateValues),
			isDeletable: bindingEntry.isDeletable,
			isMutable: bindingEntry.isMutable,
			isInitialized: bindingEntry.isInitialized
		};
	}
	newEnvRec._ambiguousContext = source._ambiguousContext;

	// Clone the outer lexical environment
	if (source.outer) {
		if (source.outer.envRec instanceof DeclarativeEnvironmentRecord) {
			outer = this.cloneDeclarativeEnvironment(source.outer);
		} else {
			outer = this.cloneObjectEnvironment(source.outer);
		}
	}

	return new LexicalEnvironment(newEnvRec, outer);
};

Cloner.prototype.cloneObjectEnvironment = function cloneObjectEnvironment(source) {
	var newEnvRec = new ObjectEnvironmentRecord(this.cloneObject(source.envRec._bindingObject)),
		outer;

	newEnvRec._ambiguousContext = source.envRec._ambiguousContext;

	// Clone the outer lexical environment
	if (source.outer) {
		if (source.outer.envRec instanceof DeclarativeEnvironmentRecord) {
			outer = this.cloneDeclarativeEnvironment(source.outer);
		} else {
			outer = this.cloneObjectEnvironment(source.outer);
		}
	}

	return new LexicalEnvironment(newEnvRec, outer);
};

Cloner.prototype.cloneValue = function cloneValue(source) {
	var cloned = this._valueMap.get(source);
	if (cloned) {
		return cloned;
	}
	if (source.dontClone) {
		return source;
	}
	switch(source.className) {
		case 'Undefined':
			cloned = this.cloneUndefined(source);
			break;
		case 'Null':
			cloned = this.cloneNull(source);
			break;
		case 'String':
			cloned = source instanceof StringPrototypeType ? this.cloneObject(source) : this.cloneString(source);
			break;
		case 'Number':
			cloned = source instanceof NumberPrototypeType ? this.cloneObject(source) : this.cloneNumber(source);
			break;
		case 'Boolean':
			cloned = source instanceof BooleanPrototypeType ? this.cloneObject(source) : this.cloneBoolean(source);
			break;
		// TODO: This is a hack since arguments objects have a few special overridden internal methods, but it's close enough for now.
		case 'Arguments':
		case 'Object':
			cloned = this.cloneObject(source);
			break;
		case 'Function':
			cloned = this.cloneFunction(source);
			break;
		case 'Array':
			cloned = this.cloneArray(source);
			break;
		case 'RegExp':
			cloned = this.cloneRegExp(source);
			break;
		case 'Error':
		case 'EvalError':
		case 'RangeError':
		case 'ReferenceError':
		case 'SyntaxError':
		case 'TypeError':
		case 'URIError':
			cloned = this.cloneError(source);
			break;
		case 'Reference':
			cloned = this.cloneReference(source);
			break;
		case 'Unknown':
			cloned = this.cloneUnknown(source);
			break;
		default:
			throw new Error('Internal Error: Cannot clone value of unknown class type "' + source.className + '"');
	}
	return cloned;
};

Cloner.prototype.cloneUndefined = function cloneUndefined(source) {
	var cloned = new UndefinedType();
	if (!this._valueMap.has(source)) {
		this._valueMap.set(source, cloned);
	}
	return cloned;
};

Cloner.prototype.cloneNull = function cloneNull(source) {
	var cloned = new NullType();
	if (!this._valueMap.has(source)) {
		this._valueMap.set(source, cloned);
	}
	return cloned;
};

Cloner.prototype.cloneString = function cloneString(source) {
	var cloned = new StringType(source.value);
	if (!this._valueMap.has(source)) {
		this._valueMap.set(source, cloned);
	}
	return cloned;
};

Cloner.prototype.cloneNumber = function cloneNumber(source) {
	var cloned = new NumberType(source.value);
	if (!this._valueMap.has(source)) {
		this._valueMap.set(source, cloned);
	}
	return cloned;
};

Cloner.prototype.cloneBoolean = function cloneBoolean(source) {
	var cloned = new BooleanType(source.value);
	if (!this._valueMap.has(source)) {
		this._valueMap.set(source, cloned);
	}
	return cloned;
};

Cloner.prototype.cloneProperties = function cloneProperties(source, destination) {
	var i, ilen, j, jlen;
	for (i = 0, ilen = source._properties.length; i < ilen; i++) {
		destination._properties[i] = {
			value: this.cloneDescriptor(source._properties[i].value),
			alternateValues: {}
		};
		for (j = 0, jlen = source._properties.length; j < jlen; j++) {
			destination._properties[i].alternateValues[i] =
				this.cloneDescriptor(source._properties[i].alternateValues[i]);
		}
	}
};

Cloner.prototype.cloneDescriptor = function cloneDescriptor(sourceDesc) {
	var newDesc = {
			enumerable: sourceDesc.enumerable,
			configurable: sourceDesc.configurable,
		};
	if (isDataDescriptor(sourceDesc)) {
		newDesc.value = this.cloneValue(sourceDesc.value);
		newDesc.writable = sourceDesc.writable;
	} else {
		newDesc.get = sourceDesc.get && this.cloneValue(sourceDesc.get);
		newDesc.set = sourceDesc.set && this.cloneValue(sourceDesc.set);
	}
	return newDesc;
};

Cloner.prototype.cloneObject = function cloneObject(source) {
	var newObject = new ObjectType(source.className, undefined, true);
	if (!this._valueMap.has(source)) {
		this._valueMap.set(source, newObject);
	}
	newObject.extensible = source.extensible;
	this.cloneProperties(newObject, source);
	newObject.objectPrototype = source.objectPrototype && this.cloneValue(source.objectPrototype);
	return newObject;
};

Cloner.prototype.cloneFunction = function cloneFunction(source) {
	var newFunc;
	if (source instanceof FunctionType) {
		newFunc = new FunctionType(
			source.formalParameters,
			source._ast,
			undefined, // Note: we wait to clone the scope until after the mapping is created to break a cyclic dependency
			source.strict,
			source.className);
		if (!this._valueMap.has(source)) {
			this._valueMap.set(source, newFunc);
		}
		if (source.scope.envRec instanceof DeclarativeEnvironmentRecord) {
			newFunc.scope = this.cloneDeclarativeEnvironment(source.scope);
		} else {
			newFunc.scope = this.cloneObjectEnvironment(source.scope);
		}
	} else {
		newFunc = source.constructor.instantiateClone ?
			source.constructor.instantiateClone(source) :
			new source.constructor(source.className);
		newFunc.callFunction = source.callFunction;
		newFunc.construct = source.construct;
		if (!this._valueMap.has(source)) {
			this._valueMap.set(source, newFunc);
		}
	}
	newFunc.extensible = source.extensible;
	this.cloneProperties(newFunc, source);
	newFunc.objectPrototype = source.objectPrototype && this.cloneValue(source.objectPrototype);
	return newFunc;
};

Cloner.prototype.cloneArray = function cloneArray(source) {
	var newObject = new ArrayType(source.className);
	if (!this._valueMap.has(source)) {
		this._valueMap.set(source, newObject);
	}
	newObject.extensible = source.extensible;
	this.cloneProperties(newObject, source);
	newObject.objectPrototype = source.objectPrototype && this.cloneValue(source.objectPrototype);
	return newObject;
};

Cloner.prototype.cloneRegExp = function cloneRegExp(source) {
	var newObject = new RegExpType(source._pattern, source._flags, source.className);
	if (!this._valueMap.has(source)) {
		this._valueMap.set(source, newObject);
	}
	newObject.extensible = source.extensible;
	this.cloneProperties(newObject, source);
	newObject.objectPrototype = source.objectPrototype && this.cloneValue(source.objectPrototype);
	return newObject;
};

Cloner.prototype.cloneError = function cloneError(source) {
	var cloned = this.cloneObject(source);
	cloned._errorType = source._errorType;
	return cloned;
};

Cloner.prototype.cloneReference = function cloneReference(source) {
	var cloned = new ReferenceType(this.cloneValue(source.value), source.referencedName, source.strictReference);
	if (!this._valueMap.has(source)) {
		this._valueMap.set(source, cloned);
	}
	return cloned;
};

Cloner.prototype.cloneUnknown = function cloneUnknown(source) {
	var cloned = new UnknownType();
	if (!this._valueMap.has(source)) {
		this._valueMap.set(source, cloned);
	}
	return cloned;
};
