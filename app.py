from dotenv import load_dotenv
import os
# Load environment variables FIRST
load_dotenv()

from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import datetime
from functools import wraps
import os
import jwt
from jwt import PyJWKClient
from urllib.request import urlopen
import json

class ValidationError(Exception):
    """Custom validation error"""
    def __init__(self, message, status_code=400):
        self.message = message
        self.status_code = status_code

def validate_required_fields(data, required_fields):
    """Validate that all required fields are present"""
    missing = [field for field in required_fields if field not in data or data[field] is None]
    if missing:
        raise ValidationError(f"Missing required fields: {', '.join(missing)}")

def validate_positive_number(value, field_name):
    """Validate that a number is positive"""
    try:
        num = float(value)
        if num <= 0:
            raise ValidationError(f"{field_name} must be positive")
        return num
    except (TypeError, ValueError):
        raise ValidationError(f"{field_name} must be a valid number")

def validate_integer(value, field_name, min_val=None, max_val=None):
    """Validate that a value is an integer within range"""
    try:
        num = int(value)
        if min_val is not None and num < min_val:
            raise ValidationError(f"{field_name} must be at least {min_val}")
        if max_val is not None and num > max_val:
            raise ValidationError(f"{field_name} must be at most {max_val}")
        return num
    except (TypeError, ValueError):
        raise ValidationError(f"{field_name} must be a valid integer")

app = Flask(__name__)
CORS(app)

# Auth0 Configuration
AUTH0_DOMAIN = os.environ.get('AUTH0_DOMAIN')
API_AUDIENCE = os.environ.get('AUTH0_API_AUDIENCE')
ALGORITHMS = ["RS256"]

# Database configuration
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'postgresql://liftlogger:LiftLogger2024!@localhost/liftlogger_dev')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_pre_ping': True,
    'pool_recycle': 300,
}

db = SQLAlchemy(app)

# ============= AUTH DECORATOR =============

def get_token_auth_header():
    """Obtains the Access Token from the Authorization Header"""
    auth = request.headers.get("Authorization", None)
    if not auth:
        return None
    
    parts = auth.split()
    if parts[0].lower() != "bearer":
        return None
    elif len(parts) == 1:
        return None
    elif len(parts) > 2:
        return None
    
    token = parts[1]
    return token

def verify_token(token):
    """Verify Auth0 token"""
    if not AUTH0_DOMAIN or not API_AUDIENCE:
        # Development mode - skip auth
        return None
    
    try:
        jwks_url = f'https://{AUTH0_DOMAIN}/.well-known/jwks.json'
        jwks_client = PyJWKClient(jwks_url)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=ALGORITHMS,
            audience=API_AUDIENCE,
            issuer=f'https://{AUTH0_DOMAIN}/'
        )
        return payload
    except Exception as e:
        print(f"Token verification error: {e}")
        return None

def requires_auth(f):
    """Decorator to require authentication"""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = get_token_auth_header()
        if not token:
            return jsonify({'error': 'Authorization header missing'}), 401
        
        payload = verify_token(token)
        if not payload:
            return jsonify({'error': 'Invalid token'}), 401
        
        # Get or create user
        auth0_id = payload.get('sub')
        user = User.query.filter_by(auth0_id=auth0_id).first()
        try:  
            if not user:
                # Create user on first login
                email = (payload.get('email') or 
                        payload.get(f'{AUTH0_DOMAIN}/email') or 
                        payload.get('nickname', auth0_id) + '@noemail.com'
                        )
                name = (payload.get('name') or 
                        payload.get('nickname') or 
                        email.split('@')[0]
                        )
                user = User(
                    auth0_id=auth0_id,
                    email=email,
                    name=name
                )
                db.session.add(user)
                db.session.commit()
            else:
                # Update last login
                user.last_login = datetime.utcnow()
                db.session.commit()
                
            # Pass user to the route
            return f(user, *args, **kwargs)
        except Exception as e:
            db.session.rollback()
            print(f"Database error in auth: {str(e)}")
            return jsonify({'error': 'Database error during authentication'}), 500
    
    return decorated

# ============= MODELS =============

class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    auth0_id = db.Column(db.String(255), unique=True, nullable=False)
    email = db.Column(db.String(255), unique=False, nullable=True)
    name = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime, default=datetime.utcnow)
    
    workouts = db.relationship('Workout', backref='user', lazy=True, cascade='all, delete-orphan')
    body_weights = db.relationship('BodyWeight', backref='user', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'name': self.name,
            'created_at': self.created_at.isoformat()
        }


class Workout(db.Model):
    __tablename__ = 'workouts'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    date = db.Column(db.Date, nullable=False, default=datetime.utcnow().date)
    workout_type = db.Column(db.Integer, nullable=False)
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    ended_at = db.Column(db.DateTime)
    
    sets = db.relationship('WorkoutSet', backref='workout', lazy=True, cascade='all, delete-orphan')
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'date': self.date.isoformat(),
            'workout_type': self.workout_type,
            'notes': self.notes,
            'created_at': self.created_at.isoformat(),
            'ended_at': self.ended_at.isoformat() if self.ended_at else None,
            'total_sets': len(self.sets)
        }


class Exercise(db.Model):
    __tablename__ = 'exercises'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    muscle_group = db.Column(db.String(50))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    sets = db.relationship('WorkoutSet', backref='exercise', lazy=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'muscle_group': self.muscle_group
        }


class WorkoutSet(db.Model):
    __tablename__ = 'workout_sets'
    
    id = db.Column(db.Integer, primary_key=True)
    workout_id = db.Column(db.Integer, db.ForeignKey('workouts.id'), nullable=False)
    exercise_id = db.Column(db.Integer, db.ForeignKey('exercises.id'), nullable=False)
    set_number = db.Column(db.Integer, nullable=False)
    weight = db.Column(db.Float, nullable=False)
    reps = db.Column(db.Integer, nullable=False)
    feel_rating = db.Column(db.Integer)
    rpe = db.Column(db.Float)
    tempo = db.Column(db.String(50))
    rest_time = db.Column(db.Integer)
    is_dropset = db.Column(db.Boolean, default=False)
    dropset_parent_id = db.Column(db.Integer, db.ForeignKey('workout_sets.id'))
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    dropsets = db.relationship('WorkoutSet', backref=db.backref('parent_set', remote_side=[id]))
    
    def to_dict(self):
        return {
            'id': self.id,
            'workout_id': self.workout_id,
            'exercise_id': self.exercise_id,
            'exercise_name': self.exercise.name,
            'set_number': self.set_number,
            'weight': self.weight,
            'reps': self.reps,
            'feel_rating': self.feel_rating,
            'rpe': self.rpe,
            'tempo': self.tempo,
            'rest_time': self.rest_time,
            'is_dropset': self.is_dropset,
            'dropset_parent_id': self.dropset_parent_id,
            'notes': self.notes,
            'created_at': self.created_at.isoformat()
        }


class BodyWeight(db.Model):
    __tablename__ = 'body_weights'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    date = db.Column(db.Date, nullable=False, default=datetime.utcnow().date)
    weight = db.Column(db.Float, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'date': self.date.isoformat(),
            'weight': self.weight,
            'created_at': self.created_at.isoformat()
        }


# ============= API ENDPOINTS =============

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint - no auth required"""
    return jsonify({'status': 'healthy', 'timestamp': datetime.utcnow().isoformat()})


# ===== USER ENDPOINTS =====

@app.route('/api/user/me', methods=['GET'])
@requires_auth
def get_current_user(user):
    """Get current user profile"""
    return jsonify(user.to_dict())


# ===== WORKOUT ENDPOINTS =====

@app.route('/api/workouts/start', methods=['POST'])
@requires_auth
def start_workout(user):
    """Start a new workout"""
    data = request.json
    
    try:
        validate_required_fields(data, ['workout_type'])
        workout_type = validate_integer(data['workout_type'], 'workout_type', 1, 6)
        
        #validate date if provided
        if 'date' in data and data['date']:
            date = validate_date(data['date']) 
        else: 
            date = datetime.utcnow().date()
            
    except ValidationError as e:
        return jsonify({'error': e.message}), e.status_code
    
    workout = Workout(
        user_id=user.id,
        date=datetime.strptime(data.get('date', datetime.utcnow().date().isoformat()), '%Y-%m-%d').date(),
        workout_type=data['workout_type'],
        notes=data.get('notes', '')
    )
    
    try: 
        db.session.add(workout)
        db.session.commit()
        return jsonify(workout.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Failed to create workout'}), 500


@app.route('/api/workouts/<int:workout_id>/end', methods=['PUT'])
@requires_auth
def end_workout(user, workout_id):
    """End a workout"""
    workout = Workout.query.filter_by(id=workout_id, user_id=user.id).first_or_404()
    workout.ended_at = datetime.utcnow()
    db.session.commit()
    
    return jsonify(workout.to_dict())


@app.route('/api/workouts/today', methods=['GET'])
@requires_auth
def get_today_workout(user):
    """Get today's workout if exists"""
    today = datetime.utcnow().date()
    workout = Workout.query.filter_by(user_id=user.id, date=today).first()
    
    if not workout:
        return jsonify({'workout': None}), 404
    
    return jsonify({
        'workout': workout.to_dict(),
        'sets': [s.to_dict() for s in workout.sets]
    })


@app.route('/api/workouts', methods=['GET'])
@requires_auth
def get_workouts(user):
    """Get all workouts for current user"""
    limit = request.args.get('limit', 50, type=int)
    workouts = Workout.query.filter_by(user_id=user.id).order_by(Workout.date.desc()).limit(limit).all()
    
    return jsonify([w.to_dict() for w in workouts])


@app.route('/api/workouts/<int:workout_id>', methods=['GET'])
@requires_auth
def get_workout(user, workout_id):
    """Get specific workout with all sets"""
    workout = Workout.query.filter_by(id=workout_id, user_id=user.id).first_or_404()
    
    return jsonify({
        'workout': workout.to_dict(),
        'sets': [s.to_dict() for s in workout.sets]
    })


# ===== EXERCISE ENDPOINTS (No auth - exercises are shared) =====

@app.route('/api/exercises', methods=['GET'])
def get_exercises():
    """Get all exercises - no auth required"""
    exercises = Exercise.query.order_by(Exercise.name).all()
    return jsonify([e.to_dict() for e in exercises])


@app.route('/api/exercises', methods=['POST'])
@requires_auth
def create_exercise(user):
    """Create a new exercise"""
    data = request.json
    
    existing = Exercise.query.filter_by(name=data['name']).first()
    if existing:
        return jsonify({'error': 'Exercise already exists', 'exercise': existing.to_dict()}), 409
    
    exercise = Exercise(
        name=data['name'],
        muscle_group=data.get('muscle_group', '')
    )
    
    db.session.add(exercise)
    db.session.commit()
    
    return jsonify(exercise.to_dict()), 201


# ===== SET ENDPOINTS =====

@app.route('/api/sets', methods=['POST'])
@requires_auth
def log_set(user):
    """Log a new set"""
    data = request.json
    
    try:
        validate_required_fields(data, ['workout_id', 'exercise_id', 'weight', 'reps'])
        
        weight = validate_positive_number(data['weight'], 'weight')
        reps = validate_integer(data['reps'], 'reps', 1)
        set_number = validate_integer(data['set_number'], 'set_number', 1)
        
        if 'feel_rating' in data and data['feel_rating'] is not None:
            feel_rating = validate_integer(data['feel_rating'], 'feel_rating', 1, 10)
        else:
            feel_rating = None
        
        if 'rpe' in data and data['rpe']:
            rpe = validate_integer(data['rpe'], 'rpe', 1, 10)
            if rpe > 10:
                raise ValidationError('rpe must be between 0 and 10')
        else:
            rpe = None
            
    except ValidationError as e:
        return jsonify({'error': e.message}), e.status_code
            
    
    # Verify workout belongs to user
    workout = Workout.query.filter_by(id=data['workout_id'], user_id=user.id).first_or_404()
    if not workout:
        return jsonify({'error': 'Workout not found'}), 404
    
    workout_set = WorkoutSet(
        workout_id=data['workout_id'],
        exercise_id=data['exercise_id'],
        set_number=data['set_number'],
        weight=data['weight'],
        reps=data['reps'],
        feel_rating=data.get('feel_rating'),
        rpe=data.get('rpe'),
        tempo=data.get('tempo', 'normal'),
        rest_time=data.get('rest_time', 0),
        is_dropset=data.get('is_dropset', False),
        dropset_parent_id=data.get('dropset_parent_id'),
        notes=data.get('notes', '')
    )
    
    try:
        db.session.add(workout_set)
        db.session.commit()   
        return jsonify(workout_set.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': 'Failed to log set'}), 500


@app.route('/api/sets/<int:set_id>', methods=['PUT'])
@requires_auth
def update_set(user, set_id):
    """Update an existing set"""
    workout_set = WorkoutSet.query.join(Workout).filter(
        WorkoutSet.id == set_id,
        Workout.user_id == user.id
    ).first_or_404()
    
    data = request.json
    workout_set.weight = data.get('weight', workout_set.weight)
    workout_set.reps = data.get('reps', workout_set.reps)
    workout_set.feel_rating = data.get('feel_rating', workout_set.feel_rating)
    workout_set.rpe = data.get('rpe', workout_set.rpe)
    workout_set.tempo = data.get('tempo', workout_set.tempo)
    workout_set.rest_time = data.get('rest_time', workout_set.rest_time)
    workout_set.is_dropset = data.get('is_dropset', workout_set.is_dropset)
    workout_set.dropset_parent_id = data.get('dropset_parent_id', workout_set.dropset_parent_id)
    workout_set.notes = data.get('notes', workout_set.notes)
    
    db.session.commit()
    return jsonify(workout_set.to_dict())


@app.route('/api/sets/<int:set_id>', methods=['DELETE'])
@requires_auth
def delete_set(user, set_id):
    """Delete a set"""
    workout_set = WorkoutSet.query.join(Workout).filter(
        WorkoutSet.id == set_id,
        Workout.user_id == user.id
    ).first_or_404()
    
    db.session.delete(workout_set)
    db.session.commit()
    
    return jsonify({'message': 'Set deleted successfully'}), 200


# ===== BODY WEIGHT ENDPOINTS =====

@app.route('/api/bodyweight', methods=['POST'])
@requires_auth
def log_bodyweight(user):
    """Log body weight"""
    data = request.json
    
    body_weight = BodyWeight(
        user_id=user.id,
        date=datetime.strptime(data.get('date', datetime.utcnow().date().isoformat()), '%Y-%m-%d').date(),
        weight=data['weight']
    )
    
    db.session.add(body_weight)
    db.session.commit()
    
    return jsonify(body_weight.to_dict()), 201


@app.route('/api/bodyweight', methods=['GET'])
@requires_auth
def get_bodyweight(user):
    """Get body weight history"""
    limit = request.args.get('limit', 100, type=int)
    weights = BodyWeight.query.filter_by(user_id=user.id).order_by(BodyWeight.date.desc()).limit(limit).all()
    
    return jsonify([w.to_dict() for w in weights])


@app.route('/api/bodyweight/latest', methods=['GET'])
@requires_auth
def get_latest_bodyweight(user):
    """Get most recent body weight"""
    weight = BodyWeight.query.filter_by(user_id=user.id).order_by(BodyWeight.date.desc()).first()
    
    if not weight:
        return jsonify({'weight': None}), 404
    
    return jsonify(weight.to_dict())


# ===== ANALYTICS ENDPOINTS =====

@app.route('/api/analytics/exercise/<int:exercise_id>', methods=['GET'])
@requires_auth
def get_exercise_analytics(user, exercise_id):
    """Get analytics for a specific exercise"""
    exercise = Exercise.query.get_or_404(exercise_id)
    
    sets = WorkoutSet.query.join(Workout).filter(
        WorkoutSet.exercise_id == exercise_id,
        Workout.user_id == user.id
    ).order_by(WorkoutSet.created_at.desc()).limit(100).all()
    
    if not sets:
        return jsonify({'exercise': exercise.to_dict(), 'analytics': None})
    
    total_volume = sum(s.weight * s.reps for s in sets)
    avg_weight = sum(s.weight for s in sets) / len(sets)
    max_weight = max(s.weight for s in sets)
    total_reps = sum(s.reps for s in sets)
    
    analytics = {
        'total_sets': len(sets),
        'total_volume': total_volume,
        'avg_weight': round(avg_weight, 2),
        'max_weight': max_weight,
        'total_reps': total_reps,
        'recent_sets': [s.to_dict() for s in sets[:10]]
    }
    
    return jsonify({
        'exercise': exercise.to_dict(),
        'analytics': analytics
    })


@app.route('/api/analytics/volume', methods=['GET'])
@requires_auth
def get_volume_analytics(user):
    """Get total volume over time"""
    days = request.args.get('days', 30, type=int)
    
    from sqlalchemy import func
    from datetime import timedelta
    
    start_date = datetime.utcnow().date() - timedelta(days=days)
    
    results = db.session.query(
        Workout.date,
        func.sum(WorkoutSet.weight * WorkoutSet.reps).label('total_volume')
    ).join(WorkoutSet).filter(
        Workout.user_id == user.id,
        Workout.date >= start_date
    ).group_by(Workout.date).order_by(Workout.date).all()
    
    return jsonify([
        {'date': r.date.isoformat(), 'volume': float(r.total_volume or 0)}
        for r in results
    ])


# ===== DATABASE INITIALIZATION =====

def seed_default_exercises():
    """Seed database with common exercises"""
    default_exercises = [
        ('Squat', 'Legs'),
        ('Bench Press', 'Chest'),
        ('Deadlift', 'Back'),
        ('Overhead Press', 'Shoulders'),
        ('Barbell Row', 'Back'),
        ('Pull-ups', 'Back'),
        ('Dips', 'Chest'),
        ('Romanian Deadlift', 'Legs'),
        ('Front Squat', 'Legs'),
        ('Incline Bench Press', 'Chest'),
        ('Lat Pulldown', 'Back'),
        ('Bicep Curl', 'Arms'),
        ('Tricep Extension', 'Arms'),
        ('Leg Press', 'Legs'),
        ('Leg Curl', 'Legs'),
        ('Leg Extension', 'Legs'),
        ('Cable Fly', 'Chest'),
        ('Face Pull', 'Shoulders'),
        ('Lateral Raise', 'Shoulders'),
        ('Calf Raise', 'Legs'),
    ]
    
    for name, muscle_group in default_exercises:
        if not Exercise.query.filter_by(name=name).first():
            exercise = Exercise(name=name, muscle_group=muscle_group)
            db.session.add(exercise)
    
    db.session.commit()
    print(f"Seeded {len(default_exercises)} default exercises")


@app.cli.command()
def init_db():
    """Initialize the database"""
    db.create_all()
    seed_default_exercises()
    print("Database initialized!")


@app.cli.command()
def reset_db():
    """Reset the database (WARNING: deletes all data)"""
    db.drop_all()
    db.create_all()
    seed_default_exercises()
    print("Database reset complete!")


# ===== ERROR HANDLERS =====
@app.errorhandler(ValidationError)
def handle_validation_error(error):
    return jsonify({'error': error.message}), error.status_code

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Resource not found'}), 404


@app.errorhandler(500)
def internal_error(error):
    db.session.rollback()
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)