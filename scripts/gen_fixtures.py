"""Generate reference games from the original Python engine.

The original coursework engine lives on the `original` branch. This
script loads it straight from git, plays random games with it, and records
every position's legal moves, resulting board and score. The TypeScript
engine's tests replay these games and must agree at every step.

    python3 scripts/gen_fixtures.py > src/engine/fixtures.json
"""

import json
import random
import subprocess
import sys

source = subprocess.run(
    ["git", "show", "original:Go.py"], check=True, capture_output=True, text=True
).stdout
engine = {"__name__": "original_go"}
exec(compile(source, "Go.py", "exec"), engine)  # noqa: S102 - our own trusted code
g = type("Engine", (), {k: staticmethod(v) for k, v in engine.items() if callable(v)})


def serialize(goban, n):
    return "".join(
        g.stone_to_str(g.get_stone(goban, g.create_intersection(chr(65 + col), row + 1)))
        for row in range(n)
        for col in range(n)
    )


def random_game(n, max_moves, rng):
    """Mirrors the turn loop in the original `go()` function, without input()."""
    goban = g.create_empty_goban(n)
    prev_goban = g.create_copy_goban(goban)
    player_white = False  # Black starts
    passes = 0
    steps = []
    points = [g.create_intersection(chr(65 + c), r + 1) for r in range(n) for c in range(n)]

    while passes < 2 and len(steps) < max_moves:
        stone = g.create_white_stone() if player_white else g.create_black_stone()
        legal = [p for p in points if g.is_legal_play(goban, p, stone, prev_goban)]
        current = g.create_copy_goban(goban)

        # Prefer moves that capture so games reach ko fights; pass rarely.
        if not legal or rng.random() < 0.02:
            move = "P"
            passes += 1
        else:
            capturing = []
            for p in legal:
                trial = g.create_copy_goban(goban)
                g.play(trial, p, stone)
                if sum(g.get_num_player_stones(trial)) <= sum(g.get_num_player_stones(goban)):
                    capturing.append(p)
            choice = rng.choice(capturing) if capturing and rng.random() < 0.6 else rng.choice(legal)
            g.play(goban, choice, stone)
            move = g.intersection_to_str(choice)
            passes = 0

        white, black = g.calculate_points(goban)
        steps.append({
            "legal": sorted(g.intersection_to_str(p) for p in legal),
            "move": move,
            "board": serialize(goban, n),
            "score": [black, white],
        })
        prev_goban = current
        player_white = not player_white

    return {"size": n, "steps": steps}


def main():
    rng = random.Random(2023)
    games = [random_game(9, 200, rng) for _ in range(12)]
    games += [random_game(13, 120, rng) for _ in range(2)]
    json.dump({"games": games}, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
