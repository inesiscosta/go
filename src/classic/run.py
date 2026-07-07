"""
Runs the original 2023 text game (Go.py, a byte-for-byte copy of the `original` branch) in Pyodide.

Go.py reads moves with input(), which blocks until a line is typed. A browser can't block, so before running
it, every function that calls input(), directly or through another such function, is turned into a
coroutine, and those calls are awaited. Only the syntax tree is changed: the file stays exactly as it was
submitted, and tracebacks still point at its real line numbers.

Expects two globals from JavaScript: GO_SOURCE (the text of Go.py) and read_line (an async function that
resolves with the next line the player types).
"""

import ast


def _make_async(tree: ast.Module) -> ast.Module:
    functions = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}

    def called_names(node: ast.AST) -> set:
        return {c.func.id for c in ast.walk(node) if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}

    # input() blocks, and so does everything that ends up calling it
    blocking = {"input"}
    changed = True
    while changed:
        changed = False
        for name, function in functions.items():
            if name not in blocking and called_names(function) & blocking:
                blocking.add(name)
                changed = True

    class AwaitBlockingCalls(ast.NodeTransformer):
        def visit_Call(self, node: ast.Call) -> ast.AST:
            self.generic_visit(node)
            if isinstance(node.func, ast.Name) and node.func.id in blocking:
                return ast.copy_location(ast.Await(value=node), node)
            return node

    tree = AwaitBlockingCalls().visit(tree)
    for i, node in enumerate(tree.body):
        if isinstance(node, ast.FunctionDef) and node.name in blocking:
            fields = {field: getattr(node, field) for field in node._fields}
            tree.body[i] = ast.copy_location(ast.AsyncFunctionDef(**fields), node)
    return ast.fix_missing_locations(tree)


async def _input(prompt=""):
    print(prompt, end="", flush=True)
    line = await read_line()  # noqa: F821 (provided by JavaScript)
    print(line)  # echo it, like a terminal does
    return line


async def run(source: str) -> None:
    tree = _make_async(ast.parse(source, "Go.py"))
    code = compile(tree, "Go.py", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
    namespace = {"__name__": "__main__", "input": _input}
    result = eval(code, namespace)  # runs the module, including its `if __name__ == "__main__":` game loop
    if result is not None:
        await result


await run(GO_SOURCE)  # noqa: F704, F821
