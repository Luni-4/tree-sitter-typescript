const PREC = {
  ACCESSIBILITY: 1,
  DEFINITION: 1,
  DECLARATION: 1,
  AS_EXPRESSION: 1,
  // INTERSECTION: 2,
  // UNION: 2,
  FUNCTION_TYPE: 1,
  CONDITIONAL_TYPE: 2,
  INTERSECTION: 3,
  UNION: 3,
  PLUS: 4,
  REL: 5,
  TIMES: 6,
  TYPEOF: 7,
  EXTENDS: 7,
  NEG: 9,
  INC: 10,
  NON_NULL: 10,
  CALL: 11,
  NEW: 12,
  FLOW_MAYBE_TYPE: 12,
  ARRAY_TYPE: 13,
  MEMBER: 14,
  TYPE_ASSERTION: 16,
  TYPE_REFERENCE: 16,
  CONSTRUCTOR_TYPE: 17
};

module.exports = function defineGrammar(dialect) {
  return grammar(require('tree-sitter-javascript/grammar'), {
    name: dialect,

    externals: ($, previous) => previous.concat([
      // Allow the external scanner to tell whether it is parsing an expression
      // or a type by checking the validity of this binary operator. This is
      // needed because the rules for automatic semicolon insertion are
      // slightly different when parsing types. Any binary-only operator would
      // work.
      '||',
    ]),

    conflicts: ($, previous) => previous.concat([
      [$.call_expression, $.binary_expression],
      [$.call_expression, $.binary_expression, $.unary_expression],

      [$.nested_type_identifier, $.nested_identifier],
      [$.nested_type_identifier, $.member_expression],
      [$.nested_identifier, $.member_expression, $.nested_type_identifier],

      [$.generic_type, $._primary_type],
      [$._expression, $._primary_type, $.generic_type],
      [$.member_expression, $.nested_identifier],

      [$._parameter_name, $.predefined_type],
      [$._parameter_name, $.predefined_type, $._expression],
      [$._parameter_name, $._primary_type],
      [$._parameter_name, $._primary_type, $._expression],
      [$._parameter_name, $._expression],
      [$._parameter_name, $.assignment_expression],

      [$._call_signature, $.function_type],
      [$._call_signature, $.constructor_type],

      [$._primary_type, $.type_parameter],
      [$.jsx_opening_element, $.type_parameter],
      [$.jsx_opening_element, $.type_parameter, $._primary_type],
      [$.jsx_opening_element, $.generic_type],
      [$.jsx_namespace_name, $._primary_type],

      [$._expression, $.literal_type],
      [$._expression, $._primary_type],
      [$._expression, $.generic_type],
      [$._expression, $.predefined_type],
      [$._expression, $._rest_identifier],
      [$._expression, $._tuple_type_identifier],
      [$._expression, $.optional_identifier],

      [$.object, $.object_type],
      [$.object, $._property_name],

      [$.array, $._tuple_type_body]
    ]),

    inline: ($, previous) => previous
      .filter(rule => rule.name !== '_call_signature')
      .concat([
        $._type_identifier,
        $._enum_member,
        $._jsx_start_opening_element,
      ]),

    rules: {
      public_field_definition: ($, previous) => seq(
        optional($.accessibility_modifier),
        choice(
          seq(optional('static'), optional($.readonly)),
          seq(optional('abstract'), optional($.readonly)),
          seq(optional($.readonly), optional('abstract')),
        ),
        field('name', $._property_name),
        optional(choice('?', '!')),
        field('type', optional($.type_annotation)),
        optional($._initializer)
      ),

      call_expression: ($, previous) => choice(
        prec(PREC.CALL, seq(
          field('function', $._expression),
          field('type_arguments', optional($.type_arguments)),
          field('arguments', choice($.arguments, $.template_string))
        )),
        prec(PREC.MEMBER, seq(
          field('function', $._primary_expression),
          '?.',
          field('type_arguments', optional($.type_arguments)),
          field('arguments', $.arguments)
        ))
      ),

      new_expression: $ => prec.right(PREC.NEW, seq(
        'new',
        field('constructor', $._primary_expression),
        field('type_arguments', optional($.type_arguments)),
        field('arguments', optional($.arguments))
      )),

      _augmented_assignment_lhs: ($, previous) => choice(previous, $.non_null_expression),

      _lhs_expression: ($, previous) => choice(previous, $.non_null_expression),

      // If the dialect is regular typescript, we exclude JSX expressions and
      // include type assertions. If the dialect is TSX, we do the opposite.
      _expression: ($, previous) => {
        const choices = [
          $.as_expression,
          $.non_null_expression,
          $.internal_module,
          $.super,
        ];

        if (dialect === 'typescript') {
          choices.push($.type_assertion);
          choices.push(...previous.members.filter(member =>
            member.name !== '_jsx_element' && member.name !== 'jsx_fragment'
          ));
        } else if (dialect === 'tsx') {
          choices.push(...previous.members);
        } else {
          throw new Error(`Unknown dialect ${dialect}`);
        }

        return choice(...choices);
      },

      _jsx_start_opening_element: $ => seq(
        '<',
        choice(
          field('name', choice(
            $._jsx_identifier,
            $.jsx_namespace_name
          )),
          seq(
            field('name', choice(
              $.identifier,
              $.nested_identifier
            )),
            field('type_arguments', optional($.type_arguments))
          )
        ),
        repeat(field('attribute', $._jsx_attribute))
      ),

      // This rule is only referenced by _expression when the dialect is 'tsx'
      jsx_opening_element: $ => prec.dynamic(-1, seq(
        $._jsx_start_opening_element,
        '>'
      )),

      // tsx only. See jsx_opening_element.
      jsx_self_closing_element: $ => prec.dynamic(-1, seq(
        $._jsx_start_opening_element,
        '/',
        '>'
      )),

      _import_export_specifier: ($, previous) => seq(
        optional(choice('type', 'typeof')),
        previous
      ),

      import_statement: $ => prec(PREC.DECLARATION, seq(
        'import',
        optional(choice('type', 'typeof')),
        choice(
          seq($.import_clause, $._from_clause),
          $.import_require_clause,
          $.string
        ),
        $._semicolon
      )),

      export_statement: ($, previous) => prec(PREC.DECLARATION, choice(
        previous,
        seq('export', '=', $.identifier, $._semicolon),
        seq('export', 'as', 'namespace', $.identifier, $._semicolon)
      )),

      non_null_expression: $ => prec.left(PREC.NON_NULL, seq(
        $._expression, '!'
      )),

      variable_declarator: $ => choice(
        seq(
          field('name', choice($.identifier, $._destructuring_pattern)),
          field('type', optional($.type_annotation)),
          optional($._initializer)
        ),
        prec(PREC.DECLARATION, seq(
          field('name', $.identifier),
          '!',
          field('type', $.type_annotation)
        ))
      ),

      method_signature: $ => seq(
        optional($.accessibility_modifier),
        optional('static'),
        optional($.readonly),
        optional('async'),
        optional(choice('get', 'set', '*')),
        field('name', $._property_name),
        optional('?'),
        $._call_signature
      ),

      abstract_method_signature: $ => seq(
        optional($.accessibility_modifier),
        'abstract',
        optional(choice('get', 'set', '*')),
        field('name', $._property_name),
        optional('?'),
        $._call_signature
      ),

      parenthesized_expression: ($, previous) => seq(
        '(',
        choice(
          seq($._expression, optional($.type_annotation)),
          $.sequence_expression
        ),
        ')'
      ),

      _formal_parameter: $ => seq(
        repeat(field('decorator', $.decorator)),
        choice(
          $.required_parameter,
          $.rest_parameter,
          $.optional_parameter
        )
      ),

      function_signature: $ => seq(
        optional('async'),
        'function',
        field('name', $.identifier),
        $._call_signature,
        $._semicolon
      ),

      class_body: $ => seq(
        '{',
        repeat(choice(
          $.decorator,
          seq($.method_definition, optional($._semicolon)),
          seq(
            choice(
              $.abstract_method_signature,
              $.index_signature,
              $.method_signature,
              $.public_field_definition
            ),
            choice($._semicolon, ',')
          )
        )),
        '}'
      ),

      method_definition: $ => prec.left(seq(
        optional($.accessibility_modifier),
        optional('static'),
        optional($.readonly),
        optional('async'),
        optional(choice('get', 'set', '*')),
        field('name', $._property_name),
        optional('?'),
        $._call_signature,
        field('body', $.statement_block)
      )),

      _declaration: ($, previous) => choice(
        previous,
        $.function_signature,
        $.abstract_class_declaration,
        $.module,
        prec(PREC.DECLARATION, $.internal_module),
        $.type_alias_declaration,
        $.enum_declaration,
        $.interface_declaration,
        $.import_alias,
        $.ambient_declaration
      ),

      type_assertion: $ => prec(PREC.TYPE_ASSERTION, seq(
        $.type_arguments,
        $._expression
      )),

      as_expression: $ => prec.left(PREC.AS_EXPRESSION, seq(
        $._expression,
        'as',
        choice($._type, $.template_string)
      )),

      class_heritage: $ => choice(
        seq($.extends_clause, optional($.implements_clause)),
        $.implements_clause
      ),

      import_require_clause: $ => seq($.identifier, '=', 'require', '(', $.string, ')'),

      implements_clause: $ => seq(
        'implements',
        commaSep1($._type)
      ),

      ambient_declaration: $ => seq(
        'declare',
        choice(
          $._declaration,
          seq('global', $.statement_block),
          seq('module', '.', alias($.identifier, $.property_identifier), ':', $._type)
        )
      ),

      class: $ => seq(
        repeat(field('decorator', $.decorator)),
        'class',
        field('name', optional($._type_identifier)),
        field('type_parameters', optional($.type_parameters)),
        optional($.class_heritage),
        field('body', $.class_body)
      ),

      abstract_class_declaration: $ => seq(
        'abstract',
        'class',
        field('name', $._type_identifier),
        field('type_parameters', optional($.type_parameters)),
        optional($.class_heritage),
        field('body', $.class_body)
      ),

      class_declaration: $ => prec.left(PREC.DECLARATION, seq(
        repeat(field('decorator', $.decorator)),
        'class',
        field('name', $._type_identifier),
        field('type_parameters', optional($.type_parameters)),
        optional($.class_heritage),
        field('body', $.class_body),
        optional($._automatic_semicolon)
      )),

      module: $ => seq(
        'module',
        $._module
      ),

      internal_module: $ => seq(
        'namespace',
        $._module
      ),

      _module: $ => prec.right(seq(
        field('name', choice($.string, $.identifier, $.nested_identifier)),
        field('body', optional($.statement_block))
      )),

      import_alias: $ => seq(
        'import',
        $.identifier,
        '=',
        choice($.identifier, $.nested_identifier),
        $._semicolon
      ),

      nested_type_identifier: $ => prec(PREC.MEMBER, seq(
        field('module', choice($.identifier, $.nested_identifier)),
        '.',
        field('name', $._type_identifier)
      )),

      interface_declaration: $ => seq(
        'interface',
        field('name', $._type_identifier),
        field('type_parameters', optional($.type_parameters)),
        optional($.extends_clause),
        field('body', $.object_type)
      ),

      extends_clause: $ => prec(PREC.EXTENDS, seq(
        'extends',
        commaSep1(choice(
          prec(PREC.TYPE_REFERENCE, choice(
            $._type_identifier,
            $.nested_type_identifier,
            $.generic_type
          )),
          $._expression
        ))
      )),

      enum_declaration: $ => seq(
        optional('const'),
        'enum',
        field('name', $.identifier),
        field('body', $.enum_body)
      ),

      enum_body: $ => seq(
        '{',
        optional(seq(
          sepBy1(',', choice(
            $._property_name,
            $.enum_assignment
          )),
          optional(',')
        )),
        '}'
      ),

      enum_assignment: $ => seq(
        $._property_name,
        $._initializer
      ),

      type_alias_declaration: $ => seq(
        'type',
        field('name', $._type_identifier),
        field('type_parameters', optional($.type_parameters)),
        '=',
        field('value', $._type),
        $._semicolon
      ),

      accessibility_modifier: $ => prec.left(PREC.ACCESSIBILITY, choice(
        'public',
        'private',
        'protected'
      )),

      readonly: $ => 'readonly',

      required_parameter: $ => seq(
        $._parameter_name,
        optional($.type_annotation),
        optional($._initializer)
      ),

      optional_parameter: $ => seq(
        $._parameter_name,
        '?',
        optional($.type_annotation),
        optional($._initializer)
      ),

      _parameter_name: $ => seq(
        optional($.accessibility_modifier),
        optional($.readonly),
        choice(
          $.identifier,
          alias($._reserved_identifier, $.identifier),
          $._destructuring_pattern,
          $.this
        )
      ),

      _rest_identifier: $ => seq(
        '...',
        $.identifier,
      ),

      rest_identifier: $ => $._rest_identifier,

      rest_parameter: $ => seq(
        $._rest_identifier,
        optional($.type_annotation)
      ),

      omitting_type_annotation: $ => seq('-?:', $._type),
      opting_type_annotation: $ => seq('?:', $._type),
      type_annotation: $ => seq(':', $._type),

      asserts: $ => seq(
        ':',
        'asserts',
        choice(
          $.identifier,
          $.type_predicate
        )
      ),

      _type: $ => choice(
        $._primary_type,
        $.union_type,
        $.intersection_type,
        $.function_type,
        $.constructor_type
      ),

      optional_identifier: $ => seq($.identifier, '?'),

      _tuple_type_identifier: $ => choice(
        $.identifier,
        $.optional_identifier,
        $.rest_identifier
      ),

      labeled_tuple_type_member: $ => seq($._tuple_type_identifier, $.type_annotation),

      _tuple_type_member: $ => choice(
        $._tuple_type_identifier,
        $.labeled_tuple_type_member,
      ),

      constructor_type: $ => prec.left(PREC.CONSTRUCTOR_TYPE, seq(
        'new',
        optional($.type_parameters),
        $.formal_parameters,
        '=>',
        $._type
      )),

      _primary_type: $ => choice(
        $.parenthesized_type,
        $.predefined_type,
        $._type_identifier,
        $.nested_type_identifier,
        $.generic_type,
        $.object_type,
        $.array_type,
        $.tuple_type,
        $.flow_maybe_type,
        $.type_query,
        $.index_type_query,
        $.this,
        $.existential_type,
        $.literal_type,
        $.lookup_type,
        $.conditional_type,
      ),

      conditional_type: $ => prec.left(PREC.CONDITIONAL_TYPE, seq(
        field('left', $._type),
        'extends',
        field('right', $._type),
        '?',
        field('consequence', $._type),
        ':',
        field('alternative', $._type)
      )),

      generic_type: $ => seq(
        choice(
          $._type_identifier,
          $.nested_type_identifier
        ),
        $.type_arguments
      ),

      type_predicate: $ => seq(
        choice($.identifier, $.this),
        'is',
        $._type
      ),

      type_predicate_annotation: $ => seq(
        seq(':', $.type_predicate)
      ),

      type_query: $ => prec(PREC.TYPEOF, seq(
        'typeof',
        choice($.identifier, $.nested_identifier)
      )),

      index_type_query: $ => seq(
        'keyof',
        prec.left(PREC.DECLARATION, choice($.generic_type, $._type_identifier, $.nested_type_identifier))
      ),

      lookup_type: $ => prec(PREC.ARRAY_TYPE, seq(
        $._primary_type,
        '[',
        $._type,
        ']'
      )),

      mapped_type_clause: $ => prec(1, seq(
        $._type_identifier,
        'in',
        $._type,
      )),

      literal_type: $ => choice(
        alias($._number, $.unary_expression),
        $.number,
        $.string,
        $.true,
        $.false
      ),

      _number: $ => prec.left(PREC.NEG, seq(
        field('operator', choice('-', '+')),
        field('argument', $.number)
      )),

      existential_type: $ => '*',

      flow_maybe_type: $ => prec.right(PREC.FLOW_MAYBE_TYPE, seq( '?', $._primary_type)),

      parenthesized_type: $ => seq(
        '(', $._type, ')'
      ),

      predefined_type: $ => choice(
        'any',
        'number',
        'boolean',
        'string',
        'symbol',
        'void'
      ),

      type_arguments: $ => seq(
        '<', commaSep1($._type), optional(','), '>'
      ),

      object_type: $ => seq(
        choice('{', '{|'),
        optional(seq(
          optional(choice(',', ';')),
          sepBy1(
            choice(',', $._semicolon),
            choice(
              $.export_statement,
              $.property_signature,
              $.call_signature,
              $.construct_signature,
              $.index_signature,
              $.method_signature
            )
          ),
          optional(choice(',', $._semicolon))
        )),
        choice('}', '|}')
      ),

      call_signature: $ => $._call_signature,

      property_signature: $ => seq(
        optional($.accessibility_modifier),
        optional('static'),
        optional($.readonly),
        field('name', $._property_name),
        optional('?'),
        field('type', optional($.type_annotation))
      ),

      _call_signature: $ => seq(
        field('type_parameters', optional($.type_parameters)),
        field('parameters', $.formal_parameters),
        field('return_type', optional(
          choice($.type_annotation, $.asserts, $.type_predicate_annotation)
        ))
      ),

      type_parameters: $ => seq(
        '<', commaSep1($.type_parameter), optional(','), '>'
      ),

      type_parameter: $ => seq(
        $._type_identifier,
        optional($.constraint),
        optional($.default_type)
      ),

      default_type: $ => seq(
        '=',
        $._type
      ),

      constraint: $ => seq(
        choice('extends', ':'),
        $._type
      ),

      construct_signature: $ => seq(
        'new',
        optional($.type_parameters),
        $.formal_parameters,
        optional($.type_annotation)
      ),

      index_signature: $ => seq(
        optional(
          seq(
            field("sign", optional("-")),
            $.readonly
          )
        ),
        '[',
        choice(
          seq(
            choice(
              $.identifier,
              alias($._reserved_identifier, $.identifier)
            ),
            ':',
            $._type,
          ),
          $.mapped_type_clause
        ),
        ']',
        choice(
          $.type_annotation,
          $.omitting_type_annotation,
          $.opting_type_annotation
        )
      ),

      array_type: $ => prec(PREC.ARRAY_TYPE, choice(
        seq($.readonly, $._primary_type, '[', ']'),
        prec(PREC.ARRAY_TYPE+1, seq($._primary_type, '[', ']'))
      )),

      _tuple_type_body: $ => seq(
        "[", optional(commaSep1($._tuple_type_member)), "]"
      ),

      tuple_type: $ => choice(
        prec.left(PREC.ARRAY_TYPE + 1, $._tuple_type_body),
        prec.left(PREC.ARRAY_TYPE + 2, seq($.readonly, $._tuple_type_body)),
      ),

      union_type: $ => prec.left(PREC.UNION, seq(
        optional($._type), '|', $._type
      )),

      intersection_type: $ => prec.left(PREC.INTERSECTION, seq(
        optional($._type), '&', $._type
      )),

      function_type: $ => prec.left(PREC.FUNCTION_TYPE, seq(
        optional($.type_parameters),
        $.formal_parameters,
        '=>',
        $._type
      )),

      _type_identifier: $ => alias($.identifier, $.type_identifier),

      _reserved_identifier: ($, previous) => choice(
        'declare',
        'namespace',
        'type',
        'public',
        'private',
        'protected',
        $.readonly,
        'module',
        'any',
        'number',
        'boolean',
        'string',
        'symbol',
        'export',
        previous
      ),
    },
  });
}

function commaSep1 (rule) {
  return sepBy1(',', rule);
}

function commaSep (rule) {
  return sepBy(',', rule);
}

function sepBy (sep, rule) {
  return optional(sepBy1(sep, rule))
}

function sepBy1 (sep, rule) {
  return seq(rule, repeat(seq(sep, rule)));
}
