# Datasets & Attribution

RoadGuard Qro does not collect its own training images. It uses public, labelled datasets whose
licenses **allow commercial use** (decision D5). Datasets with a *NonCommercial* clause are
explicitly excluded.

## Primary dataset — RDD2022

- **Name:** Road Damage Dataset 2022 (Crowdsensing-based Road Damage Detection Challenge, IEEE BigData 2022)
- **Content:** ~47,000 images from Japan, India, Czech Republic, Norway, United States and China,
  annotated in PASCAL VOC format.
- **License:** CC BY-SA 4.0
- **Citation:** Arya, D., Maeda, H., Ghosh, S. K., Toshniwal, D., & Sekimoto, Y. (2022).
  *RDD2022: A multi-national image dataset for automatic Road Damage Detection.* arXiv:2209.08538.
- **Classes used:**

| RDD code | RoadGuard class id | Name |
|---|---|---|
| D00 | 0 | longitudinal_crack |
| D10 | 1 | transverse_crack |
| D20 | 2 | alligator_crack |
| D40 | 3 | pothole |

All other RDD classes (e.g. D43 crosswalk blur, D44 white line blur, Repair) are dropped.

## Secondary datasets — potholes

Additional pothole-only datasets from Kaggle may be merged to reinforce class `D40`. Before adding
one, verify on its Kaggle page that the license is **CC0, CC BY or CC BY-SA**, then record it below.

| Dataset (Kaggle slug) | License | Images used | Notes |
|---|---|---|---|
| _to be filled when merged_ | | | |

The data-preparation notebook (`ml/01_prepare_data.ipynb`) accepts a list of Kaggle slugs and
converts YOLO- or VOC-formatted sources into the unified RoadGuard format.

## Local data (Querétaro pilot)

Frames from the pilot routes are labelled with Label Studio and used for fine-tuning. They are
**never** committed to this public repository (see [PRIVACY.md](PRIVACY.md)).

## Share-alike note

Model weights trained on CC BY-SA data are distributed together with this AGPL-3.0 project and this
attribution file, which satisfies the attribution and share-alike requirements.
