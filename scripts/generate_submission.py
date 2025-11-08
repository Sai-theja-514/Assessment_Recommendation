"""
Simple generator script to create a submission CSV from an Excel dataset.

Usage examples (PowerShell):
  # Generate using default heuristics
  python .\scripts\generate_submission.py -i "D:\Downloads\Gen_AI Dataset.xlsx" -o sai_theja.csv

  # If the Excel has a label column 'label', the script will train on labeled rows and predict unlabeled rows.
  python .\scripts\generate_submission.py -i "D:\Downloads\Gen_AI Dataset.xlsx" -o sai_theja.csv --label-col label --text-col text

This script uses pandas and scikit-learn (optional). Install requirements with:
  pip install -r requirements.txt

The output CSV will have columns: id,prediction
If your dataset contains an "id" column it will be used; otherwise the row index (1-based) is used as id.
"""

import argparse
import sys
from pathlib import Path
import pandas as pd


def find_text_column(df):
    # prefer common names
    candidates = ['text', 'description', 'query', 'prompt', 'content']
    for c in candidates:
        if c in df.columns:
            return c
    # fallback: first object dtype column
    for c in df.columns:
        if pd.api.types.is_string_dtype(df[c]):
            return c
    return None


def heuristic_predictions(series):
    kws = ['java','python','sql','javascript','react','collaborat','team','lead','manager','stakeholder','customer']
    s = series.fillna('').astype(str).str.lower()
    return s.apply(lambda t: int(any(k in t for k in kws)))


def train_and_predict(df, text_col, label_col):
    # Train on rows where label not null, predict where label is null
    train = df[df[label_col].notna()].copy()
    predict_df = df[df[label_col].isna()].copy()
    if train.shape[0] < 5:
        print('Not enough labeled rows for training (need >=5). Falling back to heuristic.', file=sys.stderr)
        return heuristic_predictions(df[text_col])

    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.linear_model import LogisticRegression
    except Exception as e:
        print('scikit-learn not available; falling back to heuristic:', e, file=sys.stderr)
        return heuristic_predictions(df[text_col])

    X_train = train[text_col].fillna('').astype(str)
    y_train = train[label_col].astype(int)
    X_all = df[text_col].fillna('').astype(str)

    vec = TfidfVectorizer(max_features=5000, ngram_range=(1,2))
    X_vec = vec.fit_transform(X_train)
    clf = LogisticRegression(max_iter=1000)
    clf.fit(X_vec, y_train)

    # predict for all rows (so submission covers full test set)
    X_all_vec = vec.transform(X_all)
    preds_proba = clf.predict_proba(X_all_vec)[:, 1]
    preds = (preds_proba >= 0.5).astype(int)
    return pd.Series(preds, index=df.index)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('-i', '--input', required=True, help='Path to Excel file (.xlsx)')
    p.add_argument('-o', '--output', required=True, help='Output CSV filename (e.g. firstname_lastname.csv)')
    p.add_argument('--text-col', help='Name of the text column to use (default: autodetect)')
    p.add_argument('--label-col', help='Name of the label column (optional)')
    args = p.parse_args()

    inp = Path(args.input)
    if not inp.exists():
        print(f'Input file not found: {inp}', file=sys.stderr)
        sys.exit(2)

    try:
        df = pd.read_excel(inp)
    except Exception as e:
        print('Failed to read Excel file:', e, file=sys.stderr)
        sys.exit(2)

    text_col = args.text_col or find_text_column(df)
    if not text_col:
        print('No text column found. Please pass --text-col', file=sys.stderr)
        print('Columns found:', list(df.columns), file=sys.stderr)
        sys.exit(2)

    print('Using text column:', text_col)

    label_col = args.label_col if args.label_col in df.columns else args.label_col

    # Create predictions
    if label_col and label_col in df.columns:
        preds = train_and_predict(df, text_col, label_col)
    else:
        print('No label column provided or not found — using heuristic predictions')
        preds = heuristic_predictions(df[text_col])

    # Determine id column
    id_col = 'id' if 'id' in df.columns else None
    if id_col:
        ids = df[id_col]
    else:
        ids = pd.RangeIndex(start=1, stop=len(df)+1)

    out_df = pd.DataFrame({'id': ids, 'prediction': preds})
    out_path = Path(args.output)
    out_df.to_csv(out_path, index=False)
    print('Wrote', out_path)


if __name__ == '__main__':
    main()
