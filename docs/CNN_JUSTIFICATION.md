# Why a Convolutional Neural Network?

This document justifies why road-damage detection from moving-vehicle video frames cannot be
solved reliably with classical machine-learning models (Logistic Regression, Random Forest, SVM) and
requires Deep Learning, specifically a Convolutional Neural Network (CNN).

## 1. Dimensionality and the curse of raw pixels

A single 640×480 RGB frame is a vector of

$$
640 \times 480 \times 3 = 921{,}600 \text{ features.}
$$

Tabular models applied to raw pixels:

- **Ignore spatial neighbourhoods** – each pixel is an independent feature; the model has no notion
  that adjacent pixels form an edge.
- **Are not translation invariant** – the same pothole shifted 50 px becomes a completely different
  input vector, so the model must see every damage at every position.
- **Scale poorly** – a dense layer from 921,600 inputs to 1,000 units needs ~921 million weights,
  whereas a convolutional layer with 32 filters of size 3×3×3 needs only **864** weights thanks to
  *weight sharing*.

## 2. Domain invariances

Frames captured from a dashboard vary in illumination (sunrise, noon, dusk), tree shadows, wet
pavement, rain, camera angle, vibration blur and pavement texture (asphalt vs. concrete).
Hand-crafted rules or descriptors (HOG, LBP, Canny edges + thresholds) cannot separate a tree shadow
from a crack: both produce nearly identical gradients. The invariances must be **learned from data**.

## 3. Hierarchical feature learning

Discrete 2-D convolution:

$$
(I * K)(i,j) = \sum_{m}\sum_{n} I(i+m,\, j+n)\, K(m,n)
$$

Stacking convolutions with non-linearities (SiLU) and down-sampling makes the network learn a
hierarchy automatically: **edges → textures → asymmetric shapes → "pothole" / "crack"**. The
receptive field grows with depth, combining local evidence (a crack edge) with global context (the
outline of a pothole and the surrounding lane).

## 4. The task is detection, not just classification

The system must **localize** multiple damages per image (bounding box) and **classify** each one.
YOLO11 optimizes a composite loss:

$$
\mathcal{L} = \lambda_{box}\,\mathcal{L}_{CIoU} + \lambda_{cls}\,\mathcal{L}_{BCE} + \lambda_{dfl}\,\mathcal{L}_{DFL}
$$

where $\mathcal{L}_{CIoU}$ regresses box geometry, $\mathcal{L}_{BCE}$ classifies the damage and
$\mathcal{L}_{DFL}$ (Distribution Focal Loss) refines box boundaries. YOLO11n is a CNN: a C3k2
convolutional backbone, an FPN/PAN neck and a decoupled detection head. No tabular model performs
spatial localization natively.

## 5. Empirical evidence

Notebook [`ml/02_classical_baseline.ipynb`](../ml/02_classical_baseline.ipynb) trains every model on
**the same split** of 64×64 crops labelled *damage* / *no damage*:

| Model | Features | Metric |
|---|---|---|
| Logistic Regression | flattened pixels | F1 = _fill in_ |
| Random Forest | HOG | F1 = _fill in_ |
| SVM (RBF kernel) | HOG | F1 = _fill in_ |
| CNN (MobileNetV3-Small, transfer learning) | learned | F1 = _fill in_ |
| YOLO11n (full detection, test split) | learned | mAP@0.5 = _fill in_ |

The notebook exports its results to `ml/results/baseline_results.csv`; copy the numbers into this
table after running it.

## 6. Severity scoring

Severity is a deterministic, explainable function of the CNN output:

$$
S = w_c \cdot \text{class\_weight} + w_a \cdot \frac{A_{bbox}}{A_{frame}} \cdot f(y_{center})
$$

- `class_weight`: D40 pothole = 1.0 · D20 alligator = 0.8 · D10 transverse = 0.5 · D00 longitudinal = 0.4
- $f(y)$ is a perspective correction: boxes higher in the image are farther away, so their apparent
  area is amplified.
- Thresholds map $S$ to **low / medium / high / critical**.

The implementation lives in `ml/scripts/severity.py` and is shared with the backend.
