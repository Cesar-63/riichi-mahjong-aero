"""Builds server/engine/mortal/mortal-s42.onnx from the Mortal-S42 weights.

Usage:
  python export_onnx.py <Mortal checkout> <s42-inference.pth> <output.onnx>

Needs torch, onnx and numpy. The Mortal checkout gives model.py (commit
0cff2b52982be5b1163aa9a62fb01f03ce91e0d2); the weights come from
https://huggingface.co/haor/Mortal-S42 (weights/s42-inference.pth, sha256
e5f6955b6f19007fd65315e53291b36994493046bc118b991b959e9dc596d660).

The graph is (obs [n, 1012, 34] float32, mask [n, 46] bool) -> q [n, 46], with
illegal actions at -inf. Weights are stored as float16 and cast back to
float32 inside the graph, which halves the file (21 MB); on 3000 positions
of our games it chose the same action as PyTorch every time.
"""
import sys
import types
from pathlib import Path

import numpy as np
import onnx
import torch
from onnx import TensorProto, helper, numpy_helper


def main():
    mortal, pth, out = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    # model.py only needs these constants from libriichi
    consts = types.ModuleType('libriichi.consts')
    consts.obs_shape = lambda v: {1: (938, 34), 2: (942, 34), 3: (934, 34), 4: (1012, 34)}[v]
    consts.oracle_obs_shape = lambda v: (211, 34) if v == 1 else (217, 34)
    consts.ACTION_SPACE = 46
    consts.GRP_SIZE = 7
    sys.modules['libriichi'] = types.ModuleType('libriichi')
    sys.modules['libriichi.consts'] = consts
    sys.path.insert(0, str(mortal / 'mortal'))
    from model import Brain, DQN

    state = torch.load(pth, weights_only=True, map_location='cpu')
    brain = Brain(version=4, conv_channels=192, num_blocks=40).eval()
    dqn = DQN(version=4).eval()
    brain.load_state_dict(state['mortal'], strict=True)
    dqn.load_state_dict(state['current_dqn'], strict=True)

    class Net(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.brain, self.dqn = brain, dqn

        def forward(self, obs, mask):
            return self.dqn(self.brain(obs), mask)

    tmp = out + '.fp32'
    torch.onnx.export(
        Net().eval(), (torch.zeros(1, 1012, 34), torch.ones(1, 46, dtype=torch.bool)), tmp,
        input_names=['obs', 'mask'], output_names=['q'],
        dynamic_axes={'obs': {0: 'batch'}, 'mask': {0: 'batch'}, 'q': {0: 'batch'}},
        opset_version=17, dynamo=False,
    )

    m = onnx.load(tmp)
    g = m.graph
    casts = []
    for init in list(g.initializer):
        arr = numpy_helper.to_array(init)
        if arr.dtype == np.float32 and arr.size >= 1024:
            half = numpy_helper.from_array(arr.astype(np.float16), init.name + '_fp16')
            g.initializer.remove(init)
            g.initializer.append(half)
            casts.append(helper.make_node('Cast', [half.name], [init.name], to=TensorProto.FLOAT))
    for c in reversed(casts):
        g.node.insert(0, c)
    onnx.save(m, out)
    Path(tmp).unlink()
    print('wrote', out)


if __name__ == '__main__':
    main()
