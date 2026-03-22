from sqlalchemy import Column, String, Float, Text
import uuid
from database import Base

class Workflow(Base):
    __tablename__ = "workflows"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    name = Column(String, index=True)
    nodes_json = Column(Text)
    edges_json = Column(Text)

class RunHistory(Base):
    __tablename__ = "run_history"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()), index=True)
    workflow_id = Column(String, index=True) # Foreign key theoretically, but keeping it simple string here
    status = Column(String, default="pending") # pending, running, success, failed
    execution_time = Column(Float, nullable=True)
    estimated_cost = Column(Float, nullable=True)
    logs_text = Column(Text, nullable=True)
