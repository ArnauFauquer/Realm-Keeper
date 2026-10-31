"""NAME_FILE variables. Run from backend/:
    python -m pytest tests/test_secret_files.py
"""
from config.settings import load_secret_files


def test_a_file_fills_the_variable(tmp_path):
    f = tmp_path / "key"
    f.write_text("s3cret\n")
    env = {"SESSION_SECRET_KEY_FILE": str(f)}
    load_secret_files(env)
    assert env["SESSION_SECRET_KEY"] == "s3cret"


def test_a_variable_already_set_wins(tmp_path):
    f = tmp_path / "key"
    f.write_text("from-file")
    env = {"S3_SECRET_KEY": "from-env", "S3_SECRET_KEY_FILE": str(f)}
    load_secret_files(env)
    assert env["S3_SECRET_KEY"] == "from-env"
