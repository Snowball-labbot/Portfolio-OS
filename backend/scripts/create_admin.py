import argparse
from getpass import getpass

from sqlalchemy import select

from backend.database import Base, SessionLocal, engine
from backend.models import User
from backend.security import hash_password


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update the first admin account.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", default=None)
    args = parser.parse_args()

    password = args.password or getpass("Password: ")
    if len(password) < 8:
        raise SystemExit("Password must be at least 8 characters.")

    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == args.email.lower()))
        if user:
            user.password_hash = hash_password(password)
            user.role = "admin"
            action = "Updated"
        else:
            user = User(email=args.email.lower(), password_hash=hash_password(password), role="admin")
            db.add(user)
            action = "Created"
        db.commit()
    print(f"{action} admin user: {args.email.lower()}")


if __name__ == "__main__":
    main()
