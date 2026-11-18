const literalValue = (node) =>
  node?.type === "Literal" ? node.value : undefined;

const identifierName = (node) =>
  node?.type === "Identifier" ? node.name : undefined;

const childrenOf = (node) =>
  Object.entries(node ?? {})
    .filter(([key, value]) => key !== "parent" && Array.isArray(value))
    .flatMap(([, value]) => value.filter((child) => child?.type));

function walk(node, visit) {
  if (!node?.type) return;
  visit(node);
  for (const child of childrenOf(node)) walk(child, visit);
  for (const [key, child] of Object.entries(node)) {
    if (key !== "parent" && child?.type) walk(child, visit);
  }
}

function containsCall(node, name) {
  let found = false;
  walk(node, (candidate) => {
    if (
      candidate.type === "CallExpression" &&
      identifierName(candidate.callee) === name
    )
      found = true;
  });
  return found;
}

function containsString(node, value) {
  let found = false;
  walk(node, (candidate) => {
    if (literalValue(candidate) === value) found = true;
  });
  return found;
}

function findFunction(program, name) {
  return program.body
    .map((statement) =>
      statement.type === "ExportNamedDeclaration"
        ? statement.declaration
        : statement,
    )
    .find(
      (statement) =>
        statement?.type === "FunctionDeclaration" &&
        identifierName(statement.id) === name,
    );
}

function findVariableIndex(statements, name, initializerCall) {
  return statements.findIndex(
    (statement) =>
      statement.type === "VariableDeclaration" &&
      statement.declarations.some(
        (declaration) =>
          identifierName(declaration.id) === name &&
          containsCall(declaration.init, initializerCall),
      ),
  );
}

function containsAdminApiPath(node) {
  let found = false;
  walk(node, (candidate) => {
    if (
      candidate.type === "Literal" &&
      typeof candidate.value === "string" &&
      candidate.value.startsWith("/api/admin/")
    )
      found = true;
  });
  return found;
}

function containsAdminPrefixCheck(node) {
  let found = false;
  walk(node, (candidate) => {
    if (
      candidate.type === "CallExpression" &&
      candidate.callee.type === "MemberExpression" &&
      identifierName(candidate.callee.property) === "startsWith" &&
      identifierName(candidate.callee.object) === "pathname" &&
      literalValue(candidate.arguments[0]) === "/api/admin/"
    )
      found = true;
  });
  return found;
}

function containsExactAdminRootGuard(node) {
  let found = false;
  walk(node, (candidate) => {
    if (
      candidate.type === "BinaryExpression" &&
      candidate.operator === "!==" &&
      ((identifierName(candidate.left) === "pathname" &&
        literalValue(candidate.right) === "/api/admin") ||
        (identifierName(candidate.right) === "pathname" &&
          literalValue(candidate.left) === "/api/admin"))
    )
      found = true;
  });
  return found;
}

function containsMemberPolicyCall(node) {
  let found = false;
  walk(node, (candidate) => {
    if (
      candidate.type === "CallExpression" &&
      identifierName(candidate.callee) === "isMemberScopedAdminApiMethod"
    )
      found = true;
  });
  return found;
}

function assignsScopeFrom(node, scopeFunction) {
  let found = false;
  walk(node, (candidate) => {
    if (
      candidate.type === "AssignmentExpression" &&
      candidate.operator === "=" &&
      identifierName(candidate.left) === "scope" &&
      candidate.right.type === "AwaitExpression" &&
      candidate.right.argument.type === "CallExpression" &&
      identifierName(candidate.right.argument.callee) === scopeFunction
    )
      found = true;
  });
  return found;
}

function staticSql(node) {
  if (node?.type === "Literal" && typeof node.value === "string")
    return node.value;
  if (node?.type === "TemplateLiteral")
    return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("?");
  return null;
}

function isDeployPendingCondition(node) {
  let found = false;
  walk(node, (candidate) => {
    if (
      candidate.type === "BinaryExpression" &&
      ["===", "=="].includes(candidate.operator) &&
      (literalValue(candidate.left) === "deploy_pending" ||
        literalValue(candidate.right) === "deploy_pending")
    )
      found = true;
  });
  return found;
}

export const adminApiAccessBeforeDispatch = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Resolve the centralized ADMIN API access policy before dispatching an API route.",
    },
    schema: [],
    messages: {
      gateOrder:
        "handleAdminRequest must classify and authorize ADMIN API requests before any /api/admin/* dispatch.",
    },
  },
  create(context) {
    return {
      Program(program) {
        const handler = findFunction(program, "handleAdminRequest");
        if (!handler?.body) {
          context.report({ node: program, messageId: "gateOrder" });
          return;
        }
        const statements = handler.body.body;
        const policyIndex = findVariableIndex(
          statements,
          "adminApiAccess",
          "getAdminApiAccessPolicy",
        );
        const enforcementIndex = findVariableIndex(
          statements,
          "adminApiAccessFailure",
          "enforceAdminApiAccessPolicy",
        );
        const responseGuardIndex = statements.findIndex(
          (statement) =>
            statement.type === "IfStatement" &&
            identifierName(statement.test) === "adminApiAccessFailure" &&
            statement.consequent.type === "ReturnStatement" &&
            identifierName(statement.consequent.argument) ===
              "adminApiAccessFailure",
        );
        const firstDispatchIndex = statements.findIndex(
          (statement) =>
            statement.range[0] > handler.body.range[0] &&
            containsAdminApiPath(statement),
        );

        if (
          policyIndex < 0 ||
          enforcementIndex <= policyIndex ||
          responseGuardIndex <= enforcementIndex ||
          (firstDispatchIndex >= 0 && responseGuardIndex >= firstDispatchIndex)
        ) {
          context.report({ node: handler, messageId: "gateOrder" });
        }
      },
    };
  },
};

export const adminApiPoliciesReachScopes = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep each ADMIN API policy connected to its central authentication and membership scope.",
    },
    schema: [],
    messages: {
      scopeDispatch:
        "The admin API policy switch must resolve admin, member, and profile scopes through their matching guard.",
    },
  },
  create(context) {
    return {
      Program(program) {
        const enforcement = findFunction(
          program,
          "enforceAdminApiAccessPolicy",
        );
        if (!enforcement?.body) {
          context.report({ node: program, messageId: "scopeDispatch" });
          return;
        }
        let accessSwitch;
        walk(enforcement.body, (candidate) => {
          if (
            !accessSwitch &&
            candidate.type === "SwitchStatement" &&
            identifierName(candidate.discriminant) === "policy"
          )
            accessSwitch = candidate;
        });
        const requiredScopes = new Map([
          ["admin", "getAdminScope"],
          ["member", "getMemberOperationScope"],
          ["profile", "getMemberProfileScope"],
        ]);
        const valid =
          accessSwitch &&
          [...requiredScopes].every(([policy, scopeFunction]) => {
            const branch = accessSwitch.cases.find(
              (candidate) => literalValue(candidate.test) === policy,
            );
            return branch && assignsScopeFrom(branch, scopeFunction);
          });
        if (!valid)
          context.report({ node: enforcement, messageId: "scopeDispatch" });
      },
    };
  },
};

export const adminApiPolicyFailsClosed = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep member-only API exemptions explicit and default unknown ADMIN API routes to admin scope.",
    },
    schema: [],
    messages: {
      failClosed:
        "getAdminApiAccessPolicy must use an exact ADMIN path prefix, guard member scope with the explicit method allowlist, and default to admin scope.",
    },
  },
  create(context) {
    return {
      Program(program) {
        const policy = findFunction(program, "getAdminApiAccessPolicy");
        if (!policy?.body) {
          context.report({ node: program, messageId: "failClosed" });
          return;
        }
        const statements = policy.body.body;
        const finalStatement = statements.at(-1);
        const defaultIsAdmin =
          finalStatement?.type === "ReturnStatement" &&
          literalValue(finalStatement.argument) === "admin";
        const pathBoundaryIsExact = statements.some(
          (statement) =>
            statement.type === "IfStatement" &&
            containsAdminPrefixCheck(statement.test) &&
            containsExactAdminRootGuard(statement.test) &&
            statement.consequent.type === "ReturnStatement" &&
            literalValue(statement.consequent.argument) === "none",
        );
        const memberReturns = [];
        walk(policy.body, (candidate) => {
          if (
            candidate.type === "ReturnStatement" &&
            literalValue(candidate.argument) === "member"
          )
            memberReturns.push(candidate);
        });
        const memberReturnsAreAllowlisted =
          memberReturns.length > 0 &&
          memberReturns.every((memberReturn) =>
            statements.some(
              (statement) =>
                statement.type === "IfStatement" &&
                containsMemberPolicyCall(statement.test) &&
                memberReturn.range[0] >= statement.consequent.range[0] &&
                memberReturn.range[1] <= statement.consequent.range[1],
            ),
          );

        if (
          !defaultIsAdmin ||
          !pathBoundaryIsExact ||
          !memberReturnsAreAllowlisted
        )
          context.report({ node: policy, messageId: "failClosed" });
      },
    };
  },
};

export const publicationCompareAndSet = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require optimistic concurrency predicates for verified publication state changes.",
    },
    schema: [],
    messages: {
      compareAndSet:
        "Every editorial_documents update after deployment verification must compare updated_at and handle a failed compare-and-set.",
    },
  },
  create(context) {
    return {
      Program(program) {
        const progress = findFunction(
          program,
          "progressEditorialPublicationRun",
        );
        if (!progress?.body) {
          context.report({ node: program, messageId: "compareAndSet" });
          return;
        }
        let deployBlock;
        walk(progress.body, (candidate) => {
          if (
            !deployBlock &&
            candidate.type === "IfStatement" &&
            isDeployPendingCondition(candidate.test)
          )
            deployBlock = candidate.consequent;
        });
        if (!deployBlock) {
          context.report({ node: progress, messageId: "compareAndSet" });
          return;
        }

        const documentUpdates = [];
        walk(deployBlock, (candidate) => {
          if (
            candidate.type !== "CallExpression" ||
            candidate.callee.type !== "MemberExpression" ||
            identifierName(candidate.callee.property) !== "prepare"
          )
            return;
          const sql = staticSql(candidate.arguments[0]);
          if (sql && /\bUPDATE\s+editorial_documents\b/i.test(sql))
            documentUpdates.push({ candidate, sql });
        });

        const allUpdatesCompareAndSet =
          documentUpdates.length > 0 &&
          documentUpdates.every(({ sql }) =>
            /\bWHERE\s+id\s*=\s*\?\s+AND\s+updated_at\s*=\s*\?/i.test(sql),
          );
        let batchChangeCountCalls = 0;
        const conflictRecoveryBranches = [];
        walk(deployBlock, (candidate) => {
          if (
            candidate.type === "CallExpression" &&
            identifierName(candidate.callee) === "batchChangeCount"
          )
            batchChangeCountCalls += 1;
          if (
            candidate.type === "IfStatement" &&
            containsString(
              candidate.consequent,
              "publication_compare_and_set_failed",
            )
          )
            conflictRecoveryBranches.push(candidate);
        });
        if (
          !allUpdatesCompareAndSet ||
          batchChangeCountCalls < 4 ||
          conflictRecoveryBranches.length < 3
        ) {
          context.report({ node: deployBlock, messageId: "compareAndSet" });
        }
      },
    };
  },
};
